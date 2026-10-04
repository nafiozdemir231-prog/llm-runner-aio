#!/usr/bin/env python3
# -*- coding: ascii -*-
"""local/checkargs.py - OUR audit layer (not upstream): flag/compatibility checks, no model loading.

Checks (hard problems make the exit code 1):
  * models.json well formed, port rules, idle_unload_s > 0, host/api-key rule (#9)
  * every model config exists and parses
  * engine signature rule (#2/#3): args lists of the model configs must be IDENTICAL
    (flag order and values); differences mean paying RAM twice
  * conversation parking (#4): --conversation-cache-mib 4096, --conversation-cache-slots 2,
    --conversation-cache-min-free-mib 4096 in every config's args
  * sampling blocks present and sane (top_k 1..64, 0<top_p<=1, min_p>=0); general/coder must differ

Usage: python local/checkargs.py [models.json] [--fix-args]
--fix-args copies the first model config's args into every other config (sampling blocks are kept),
after backing all configs up to .tmp/backups/manual-<timestamp>/.
"""
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARK_FLAGS = {"--conversation-cache-mib": "4096", "--conversation-cache-slots": "2",
              "--conversation-cache-min-free-mib": "4096"}
MIN_ENGINE = (0, 1, 39)
hard, warn, ok = [], [], []


def say(kind, msg):
    {"HARD": hard, "WARN": warn, "OK": ok}.get(kind, hard).append("%s: %s" % (kind, msg))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def main():
    args = sys.argv[1:]
    fix = "--fix-args" in args
    settings_path = Path(args[0]) if args and not args[0].startswith("--") else ROOT / "local" / "models.json"
    try:
        s = read_json(settings_path)
    except (OSError, ValueError) as e:
        say("HARD", "models.json unreadable: %s" % e)
        return report()
    for k in ("host", "port", "backend_port_base", "python", "models"):
        if k not in s:
            say("HARD", "models.json missing key %r" % k)
    if hard:
        return report()
    port, base = int(s["port"]), int(s["backend_port_base"])
    n_models = len(s["models"])
    if not (1024 <= port < 65536):
        say("HARD", "gateway port %d out of range" % port)
    if base <= port or base + n_models > 65536:
        say("HARD", "backend_port_base %d must be above the gateway port and leave room for %d arks" % (base, n_models))
    if float(s.get("idle_unload_s", 0)) <= 0:
        say("HARD", "idle_unload_s must be > 0 seconds (#1)")
    if str(s["host"]) not in ("127.0.0.1", "localhost", "::1") and not str(s.get("api_key", "")).strip():
        say("HARD", "host %s is exposed but api_key is empty (#9)" % s["host"])
    else:
        say("OK", "host/api-key rule satisfied (%s)" % s["host"])

    cfgs = {}
    for m in s["models"]:
        p = Path(m["config"])
        p = p if p.is_absolute() else ROOT / p
        try:
            cfgs[m["name"]] = (p, read_json(p))
        except (OSError, ValueError) as e:
            say("HARD", "model %r config unreadable (%s): %s" % (m["name"], m["config"], e))
    if len(cfgs) != len(s["models"]):
        return report()

    lists = {n: list(c.get("args") or []) for n, (p, c) in cfgs.items()}
    names = sorted(lists)
    same = all(lists[n] == lists[names[0]] for n in names) if len(names) > 1 else True
    if len(names) > 1:
        if same:
            say("OK", "args lists identical across %d configs -> single shared engine (#2)" % len(names))
        else:
            say("HARD", "args lists DIFFER between model configs -> two engines, double RAM (#3); "
                        "run with --fix-args after calibration to equalize")

    for n, (p, c) in cfgs.items():
        a = [str(x) for x in c.get("args") or []]
        for flag, value in PARK_FLAGS.items():
            i = a.index(flag) + 1 if flag in a else -1
            if i < 0 or a[i] != value:
                say("HARD", "%s: conversation parking incomplete (%s %s expected) (#4)" % (n, flag, value))
        samp = c.get("sampling")
        if not isinstance(samp, dict):
            say("WARN", "%s: no 'sampling' block in config; gateway falls back to built-in defaults" % n)
        else:
            tk, tp, mp = samp.get("top_k"), samp.get("top_p"), samp.get("min_p")
            if isinstance(tk, int) and not (1 <= tk <= 64):
                say("HARD", "%s: sampling.top_k=%r outside 1..64" % (n, tk))
            if isinstance(tp, (int, float)) and not (0 < tp <= 1):
                say("HARD", "%s: sampling.top_p=%r outside (0,1]" % (n, tp))
            if isinstance(mp, (int, float)) and not (0 <= mp <= 1):
                say("HARD", "%s: sampling.min_p=%r outside [0,1]" % (n, mp))
    temps = {n: (cfgs[n][1].get("sampling") or {}).get("temperature") for n in names}
    if len({v for v in temps.values()}) < len(temps) and all(v is not None for v in temps.values()):
        say("WARN", "all models share the same sampling temperature - profiles do not differ: %s" % temps)

    build = ROOT / "engine" / "BUILD.json"
    if build.exists():
        try:
            ver = tuple(int(x) for x in str(read_json(build).get("version", "0")).split(".")[:3])
            if ver < MIN_ENGINE:
                say("WARN", "engine %s older than recommended %s - run GUNCELLE.bat" % (".".join(map(str, ver)), ".".join(map(str, MIN_ENGINE))))
        except ValueError:
            pass
    else:
        say("WARN", "engine/BUILD.json missing (Strata not installed/updated yet)")

    if fix and len(names) > 1 and not same:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = ROOT / ".tmp" / "backups" / manual_stamp(stamp)
        backup.mkdir(parents=True, exist_ok=True)
        for n, (p, _) in cfgs.items():
            shutil.copy2(p, backup / p.name)
        src_name = names[0]
        for n in names[1:]:
            p, c = cfgs[n]
            c["args"] = list(cfgs[src_name][1].get("args") or [])     # sampling block untouched on purpose
            tmp = p.with_name(p.name + ".tmp")
            tmp.write_text(json.dumps(c, indent=1), encoding="utf-8")
            tmp.replace(p)
        say("OK", "--fix-args: args of %s copied into the others; backups in %s" % (src_name, backup))

    return report()


def manual_stamp(stamp):
    return "manual-%s" % stamp


def report():
    for line in ok:
        print(line)
    for line in warn:
        print(line)
    for line in hard:
        print(line)
    print("hard problems: %d, warnings: %d" % (len(hard), len(warn)))
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
