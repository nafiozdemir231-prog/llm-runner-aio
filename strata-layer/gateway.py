#!/usr/bin/env python3
# -*- coding: ascii -*-
"""local/gateway.py - OUR multi-model gateway layer for Strata (not upstream code).

One port (models.json) exposes several model names. Models whose engine signature
(exe + args + cwd) is IDENTICAL share a single backend serve/server.py ark, so the
same GGUF is never loaded twice; they differ only in injected sampling.
Models with different signatures get their own ark and are swapped: loading one
POSTs /unload to the rival first; if the rival is generating, the gateway answers 503.

Usage:  python local/gateway.py local/models.json [--check]
Backend arks die together with this gateway (Windows job object).
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]          # the Strata folder
SAMPLING_KEYS = ("temperature", "top_p", "top_k", "min_p", "seed", "presence_penalty",
                 "repetition_penalty", "frequency_penalty", "penalty_last_n")
# Spec defaults, used only while a config has no sampling block yet.
DEFAULT_SAMPLING = {
    "coder": {"temperature": 0.6, "top_k": 20, "top_p": 0.95, "min_p": 0.0,
              "presence_penalty": 0.0, "repetition_penalty": 1.08},
    "general": {"temperature": 1.0, "top_k": 20, "top_p": 0.95, "min_p": 0.0,
                "presence_penalty": 0.0, "repetition_penalty": 1.08},
}
CHAT_PATHS = ("/v1/chat/completions", "/v1/responses", "/v1/messages")


def load_settings(path):
    s = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    for k in ("host", "port", "backend_port_base", "python", "models"):
        if k not in s:
            raise SystemExit("models.json: missing key %r" % k)
    s.setdefault("idle_unload_s", 600)
    s.setdefault("ready_timeout_s", 1200)
    s.setdefault("min_free_vram_mib", 0)
    s.setdefault("api_key", "")
    return s


def is_loopback(host):
    return host in ("127.0.0.1", "localhost", "::1")


class Job:
    """Windows job object: every ark process dies when the gateway closes its handle."""

    KILL_ON_CLOSE = 0x2000   # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

    def __init__(self):
        self.h = None
        if os.name != "nt":
            return
        import ctypes

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                        ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", ctypes.c_uint32),
                        ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", ctypes.c_uint32), ("Affinity", ctypes.c_size_t),
                        ("PriorityClass", ctypes.c_uint32), ("SchedulingClass", ctypes.c_uint32)]

        class IO(ctypes.Structure):
            _fields_ = [("WriteTransferCount", ctypes.c_size_t), ("ReadTransferCount", ctypes.c_size_t),
                        ("OtherTransferCount", ctypes.c_size_t), ("WriteOperationCount", ctypes.c_size_t),
                        ("ReadOperationCount", ctypes.c_size_t), ("OtherOperationCount", ctypes.c_size_t)]

        class EXT(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        k32 = ctypes.windll.kernel32
        self.h = k32.CreateJobObjectW(None, None)
        if not self.h:
            return
        info = EXT()
        info.BasicLimitInformation.LimitFlags = self.KILL_ON_CLOSE
        k32.SetInformationJobObject(self.h, 9, ctypes.byref(info), ctypes.sizeof(info))

    def assign(self, popen):
        if not self.h:
            return
        import ctypes
        ctypes.windll.kernel32.AssignProcessToJobObject(self.h, ctypes.c_void_p(popen._handle))


# Ark logundan app'e tasinacak hiz satirlari: istek sonu ozetleri (done / request prompt -> prefill+decode tok/s),
# motor yukleme hizi (GiB/s) ve Faz 10 canli ilerleme satirlari ([strata] reading the prompt / thinking / answering).
# Renderer ilerleme satirlarini yutar (UI widget'larina cevirir) - log alani spam olmaz.
SPEED_LINE_RE = re.compile(r"done:|request prompt|GiB/s|reading the prompt|\] (thinking|answering): ")


def tail_speed_lines(log_path, base_offset, alive, emit):
    """log_path'i base_offset'ten itibaren kuyruklayip SPEED_LINE_RE eslesen satirlari emit eder.
    Dosya kisalirsa (truncate/rotate) offset sifirdan devam eder."""
    offset = base_offset
    while True:
        try:
            size = os.path.getsize(str(log_path))
            if size < offset:                                   # log dondu / trunc edildi
                offset = 0
            with open(str(log_path), "rb") as f:
                f.seek(offset)
                chunk = f.read()
            cut = chunk.rfind(b"\n")
            if cut >= 0:
                consumed = chunk[:cut + 1]
                offset += len(consumed)
                for raw in consumed.split(b"\n"):
                    line = raw.decode("utf-8", "replace").strip()
                    if line and SPEED_LINE_RE.search(line):
                        emit(line)
        except OSError:
            pass
        if not alive():
            break
        time.sleep(0.5)


class Ark:
    """One backend serve/server.py process (lazy start), shared by models with the same signature."""

    def __init__(self, idx, port, cfg_path, cfg, settings, job):
        self.idx, self.port = idx, port
        self.cfg_path, self.cfg = cfg_path, cfg
        self.settings, self.job = settings, job
        self.proc = None
        self.lock = threading.Lock()

    def signature(self):
        return (str(self.cfg.get("exe")), " ".join(map(str, self.cfg.get("args", []))), str(self.cfg.get("cwd")))

    def _tail_speeds(self, log_path, base_offset):
        """Ark logundaki hiz satirlarini app loguna iletir: istek basi prefill/decode tok/s
        (STRATA_REQUEST_LINES=1 ile serve stdout'a dusen satirlar) ve motor yukleme hizi (GiB/s).
        Diger satirlar dosyada kalir - UI spam olmaz."""
        def emit(line):
            print("[gateway] ark%d> %s" % (self.idx, line), flush=True)
        threading.Thread(target=tail_speed_lines, args=(log_path, base_offset, self.up, emit), daemon=True).start()

    def up(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        with self.lock:
            if self.up():
                return True
            py = ROOT / self.settings["python"]
            if not py.exists():
                print("[gateway] python not found: %s - run START-HERE.bat first" % py, flush=True)
                return False
            log_dir = ROOT / "logs"
            log_dir.mkdir(exist_ok=True)
            log_path = log_dir / ("gateway-ark%d.log" % self.idx)
            base_offset = os.path.getsize(str(log_path)) if log_path.exists() else 0
            logf = open(log_path, "ab")
            cfg_arg = self.cfg_path if self.cfg_path.is_absolute() else ROOT / self.cfg_path
            cmd = [str(py), str(ROOT / "serve" / "server.py"), "--engine", self.settings.get("engine", "strata"),
                   "--config", str(cfg_arg), "--host", "127.0.0.1", "--port", str(self.port)]
            if float(self.settings["idle_unload_s"]) > 0:
                cmd += ["--idle-unload", str(int(float(self.settings["idle_unload_s"])))]
            if int(self.settings.get("min_free_vram_mib") or 0) > 0:
                cmd += ["--min-free-vram-mib", str(int(self.settings["min_free_vram_mib"]))]
            print("[gateway] starting ark %d: port %d config %s" % (self.idx, self.port, cfg_arg.name), flush=True)
            # STRATA_REQUEST_LINES=1: serve, istek bitisinde "prefill X tok/s decode Y tok/s" satirini stdout'a basar;
            # tail_speed_lines bunu (ve GiB/s yukleme satirlarini) app loguna tasir.
            env = dict(os.environ)
            env.setdefault("STRATA_REQUEST_LINES", "1")
            self.proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=logf, stderr=subprocess.STDOUT, env=env)
            self._tail_speeds(log_path, base_offset)
            self.job.assign(self.proc)
            return self.wait_ready()

    def wait_ready(self):
        deadline = time.time() + float(self.settings["ready_timeout_s"])
        while time.time() < deadline:
            try:
                with urlopen("http://127.0.0.1:%d/health" % self.port, timeout=4) as r:
                    if r.status == 200:
                        print("[gateway] ark %d is up (the engine may still be loading inside)" % self.idx, flush=True)
                        return True
            except (URLError, OSError):
                pass
            if self.proc.poll() is not None:
                print("[gateway] ark %d exited with code %s; see logs/gateway-ark%d.log"
                      % (self.idx, self.proc.returncode, self.idx), flush=True)
                return False
            time.sleep(2)
        print("[gateway] ark %d: /health not ready within %s s" % (self.idx, self.settings["ready_timeout_s"]), flush=True)
        return False

    def request(self, method, path, body=None):
        req = Request("http://127.0.0.1:%d%s" % (self.port, path), data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            resp = urlopen(req, timeout=None if method == "POST" else 10)
            return resp.status, dict(resp.headers), resp
        except HTTPError as e:
            return e.code, dict(e.headers), e

    def slots(self):
        try:
            _, _, fp = self.request("GET", "/slots")
            data = json.loads(fp.read().decode())
            return data if isinstance(data, list) else []
        except (URLError, OSError, ValueError):
            return []

    def state(self):
        slots = self.slots()
        return {"ark": self.idx, "port": self.port, "process_up": self.up(),
                "model_loaded": bool(slots), "generating": any(s.get("is_processing") for s in slots)}

    def unload(self):
        if not self.up():
            return "not running"
        _, _, fp = self.request("POST", "/unload")
        try:
            return json.loads(fp.read().decode()).get("status", "unknown")
        except ValueError:
            return "unknown"


class Gateway:
    """Builds the model->ark map from engine signatures and enforces the swap rule."""

    def __init__(self, settings):
        self.s = settings
        self.job = Job()
        self.arks = []                        # index == ark number
        self.models = {}                      # exposed name -> {cfg_path, cfg, ark, sampling}
        for m in settings["models"]:
            cfg_path = Path(m["config"])
            if not cfg_path.is_absolute():
                cfg_path = ROOT / cfg_path
            if not cfg_path.exists():
                raise SystemExit("[gateway] HARD: model config missing: %s (run setup/calibration first)" % cfg_path)
            cfg = json.loads(cfg_path.read_text(encoding="utf-8-sig"))
            sig = (str(cfg.get("exe")), " ".join(map(str, cfg.get("args", []))), str(cfg.get("cwd")))
            ark = next((a for a in self.arks if a.signature() == sig), None)
            if ark is None:
                ark = Ark(len(self.arks), settings["backend_port_base"] + len(self.arks), cfg_path, cfg, settings, self.job)
                self.arks.append(ark)
            name = m["name"]
            default = DEFAULT_SAMPLING["coder" if "coder" in name.lower() else "general"]
            sampling = dict(cfg.get("sampling") or default)
            self.models[name] = {"cfg_path": cfg_path, "cfg": cfg, "ark": ark.idx, "sampling": sampling}

    def ark_for(self, name):
        return self.arks[self.models[name]["ark"]]

    def swap_for(self, target):
        """Before a request that may load an engine: ask every other loaded ark to unload.
        A rival that is generating keeps the GPU: return False -> the gateway answers 503."""
        for a in self.arks:
            if a is target or not a.up():
                continue
            st = a.state()
            if not st["model_loaded"]:
                continue
            if st["generating"]:
                print("[gateway] swap refused: ark %d is generating" % a.idx, flush=True)
                return False
            print("[gateway] swap: unloading ark %d (request targets ark %d)" % (a.idx, target.idx), flush=True)
            if a.unload() == "busy":
                print("[gateway] swap refused: ark %d reported busy" % a.idx, flush=True)
                return False
        return True

    def plan(self):
        """--check: print the routing plan; exit 1 on hard problems."""
        problems = []
        if not is_loopback(str(self.s["host"])) and not str(self.s.get("api_key", "")).strip():
            problems.append("NOTE: host %s acik ve api_key bos - ag uzerinden kimlik dogrulamasiz erisim (rule 9 gevsetildi)" % self.s["host"])
        print("[check] gateway http://%s:%d/v1" % (self.s["host"], self.s["port"]))
        for name, m in sorted(self.models.items()):
            a = self.arks[m["ark"]]
            samp = ", ".join("%s=%s" % kv for kv in sorted(m["sampling"].items()))
            print("[check] model %-28s -> ark %d :%d  sampling: %s" % (name, a.idx, a.port, samp))
        if len(self.arks) == 1:
            print("[check] single ark shared by all models (engine signature identical; no double RAM)")
        else:
            print("[check] %d arks: different GGUF/args -> swap rules active (rival generating => 503)" % len(self.arks))
            problems.append("NOTE: args lists differ between configs; two engines will be paid in RAM")
        print("[check] idle_unload_s=%s ready_timeout_s=%s min_free_vram_mib=%s"
              % (self.s["idle_unload_s"], self.s["ready_timeout_s"], self.s["min_free_vram_mib"]))
        for p in problems:
            print("[check] %s" % p)
        hard = sum(1 for p in problems if p.startswith("HARD"))
        print("[check] hard problems: %d" % hard)
        return 1 if hard else 0


class Handler(BaseHTTPRequestHandler):
    gw = None                                  # set in main()
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _auth_ok(self):
        key = str(self.gw.s.get("api_key", "")).strip()
        if not key:
            return True
        auth = self.headers.get("Authorization", "")
        tok = auth[7:] if auth.lower().startswith("bearer ") else auth
        xkey = self.headers.get("x-api-key", "") or self.headers.get("x-apikey", "")   # Anthropic clients
        qtok = ""                                                                      # browser convenience: /?api_key=...
        for part in (urlparse(self.path).query or "").split("&"):
            if part.startswith("api_key="):
                qtok = unquote(part[8:])
        return tok.strip() == key or xkey.strip() == key or qtok == key

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _proxy_get(self, path):
        q = urlparse(self.path).query or ""
        name = None
        for part in q.split("&"):
            if part.startswith("model="):
                name = part[6:]
        ark = self.gw.ark_for(name) if name in self.gw.models else self.gw.arks[0]
        try:
            status, headers, fp = ark.request("GET", path)
        except (URLError, OSError):
            return self._json(502, {"error": {"message": "ark %d is not reachable" % ark.idx}})
        data = fp.read()
        self.send_response(status)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if not self._auth_ok():
            return self._json(401, {"error": {"message": "invalid api key"}})
        if path in ("/v1/models", "/models"):
            data = []
            for name, m in sorted(self.models_iter()):
                ark = self.gw.arks[m["ark"]]
                entry = {"id": name, "object": "model"}
                try:
                    _, _, fp = ark.request("GET", "/v1/models")
                    lst = json.loads(fp.read().decode()).get("data", [])
                    src = next((e for e in lst if isinstance(e, dict) and e.get("id")), {})
                    entry.update(src)
                except (URLError, OSError, ValueError):
                    pass
                entry["id"] = name
                entry.setdefault("status", {"value": "loaded" if ark.up() else "unloaded"})
                entry["gateway"] = {"ark": ark.idx, "port": ark.port}
                # Vision beyani (pi/istemeciler icin): upstream #1322 semantigi -
                # config'de "vision" bolumu varsa motor gorsel kabul eder (serve --vision ekler).
                try:
                    _cfg = ark.cfg if isinstance(ark.cfg, dict) else {}
                    _v = _cfg.get("vision")
                    if isinstance(_v, dict):
                        _vis = True
                    elif isinstance(_v, str):
                        _vis = _v.strip().lower() in ("gpu", "cpu")
                    else:
                        _vis = "--vision" in [str(a) for a in (_cfg.get("args") or [])]
                    if not isinstance(entry.get("meta"), dict):
                        entry["meta"] = {}
                    entry["meta"].setdefault("vision", bool(_vis))
                except Exception:
                    pass
                data.append(entry)
            return self._json(200, {"object": "list", "data": data})
        if path == "/health":
            return self._json(200, {"status": "ok", "gateway_port": self.gw.s["port"],
                                    "models": sorted(self.gw.models), "arks": [a.state() for a in self.gw.arks]})
        if path in ("/props", "/slots", "/v1/status"):
            return self._proxy_get(path)
        if path == "/":
            return self._json(200, {"app": "Strata multi-model gateway (our layer)",
                                    "openai": "/v1/chat/completions", "anthropic": "/v1/messages",
                                    "models": "/v1/models", "health": "/health",
                                    "gateway_models": sorted(self.gw.models),
                                    "arks": [a.state() for a in self.gw.arks]})
        return self._json(404, {"error": {"message": "not found"}})

    def models_iter(self):
        return self.gw.models.items()

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._auth_ok():
            return self._json(401, {"error": {"message": "invalid api key"}})
        if path == "/unload":
            return self._json(200, {"unloaded": {str(a.idx): a.unload() for a in self.gw.arks}})
        if path not in CHAT_PATHS:
            return self._json(404, {"error": {"message": "not found"}})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length)
            body = json.loads(raw.decode()) if raw else {}
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {"error": {"message": "body must be JSON"}})
        name = str(body.get("model", "")).strip() or next(iter(self.gw.models), None)
        if name not in self.gw.models:
            return self._json(404, {"error": {"message": "unknown model %r (known: %s)" % (name, ", ".join(sorted(self.gw.models)))}})
        m = self.gw.models[name]
        ark = self.gw.arks[m["ark"]]
        # Sampling injection fills only the fields the request left empty - the caller always wins.
        for k, v in m["sampling"].items():
            if k in SAMPLING_KEYS and body.get(k) is None:
                body[k] = v
        real = m["cfg"].get("model_name") or name
        body["model"] = real
        if not ark.start():
            return self._json(503, {"error": {"message": "ark %d could not start (see logs/)" % ark.idx}})
        if len(self.gw.arks) > 1 and not self.gw.swap_for(ark):
            return self._json(503, {"error": {"message": "the other Strata model is generating; retry after it finishes"}})
        status, headers, fp = ark.request("POST", path, json.dumps(body).encode())
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                self.send_header(k, v)
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:                                   # SSE / chunked passthrough, flushed per chunk
                chunk = fp.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, URLError):
            pass
        finally:
            try:
                fp.close()
            except Exception:
                pass


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    settings = load_settings(sys.argv[1])
    check = "--check" in sys.argv[2:]
    try:
        gw = Gateway(settings)
    except SystemExit as e:                               # missing config etc. -> report, do not crash
        print(e.code if isinstance(e.code, str) else e)
        return 1
    if check:
        return gw.plan()
    if not is_loopback(str(settings["host"])) and not str(settings.get("api_key", "")).strip():
        print("[gateway] NOT: host %s api_key olmadan baglaniyor - yerel agdaki herkesten erisilebilir (rule 9 gevsetildi)"
              % settings["host"])
    Handler.gw = gw
    httpd = ThreadingHTTPServer((settings["host"], int(settings["port"])), Handler)
    print("[gateway] Strata multi-model gateway on http://%s:%s/v1 - models: %s (idle unload %ss)"
          % (settings["host"], settings["port"], ", ".join(sorted(gw.models)), settings["idle_unload_s"]), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("[gateway] stopped; job object terminates the arks", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
