/**
 * auto-model-discovery.ts (Faz 14 - data-driven)
 * -----------------------------------------------
 * Provider listesi ARTIK kodda sabit degil; providers.json'dan okunur.
 *   UI: PiCoding > Providers bolumu (ekle/sil/etkinlestir) -> picoding/providers.json
 *   Senkron: run.bat / sync_pi_config.py -> %USERPROFILE%\.pi\agent\providers.json
 * Her provider icin /v1/models cekilir ve pi'ye openai-completions olarak kaydedilir.
 *
 * providers.json semasi:
 *   { "providers": [ { "id": "strata-185", "baseUrl": "http://192.168.1.185:1235",
 *                      "apiKey": "", "enabled": true } ] }
 *
 * Bulma sirasi: PI_PICODING_PROVIDERS_JSON -> cwd/providers.json
 *              -> ~/.pi/agent/providers.json -> repodaki picoding/providers.json
 * Dosya yok/bozuk ise eski sabit LAN hedeflerine duser (geriye donuk guvenli).
 *
 * Context penceresi:
 *   1. status.args icinde --ctx-size (llama.cpp)
 *   2. status.args icinde --max-context (Strata)
 *   3. meta.n_ctx (Strata yeni format)
 *   4. context_length (bazI OpenAI uyumlu)
 *   5. Varsayilan: 128000
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_CONTEXT_WINDOW = 128000;

interface Target {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
}

// providers.json bulunamazsa kullanilan geri-donus listesi (eski sabit davranis).
const FALLBACK_TARGETS: Target[] = [
  { providerId: "llama-cpp-185", baseUrl: "http://192.168.1.185:1234" },
  { providerId: "strata-185", baseUrl: "http://192.168.1.185:1235" },
  { providerId: "llama-cpp-177", baseUrl: "http://192.168.1.177:1234" },
];

interface RawModel {
  id: string;
  name?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  context_length?: number;
  meta?: {
    n_ctx?: number;
    vision?: boolean;
  };
  architecture?: {
    input_modalities?: string[];
  };
  status?: {
    value?: string;
    args?: string[];
  };
}

/**
 * Vision yetenegi tespiti: sunucu argumanlarinda --vision (Strata) veya --mmproj
 * (llama.cpp mtmd) varsa model gorsel alabilir. meta.vision bayragi da desteklenir.
 */
function extractVision(model: RawModel): boolean {
  if (typeof model.meta?.vision === "boolean") return model.meta.vision;
  if (Array.isArray(model.architecture?.input_modalities)) {
    return model.architecture.input_modalities.includes("image");
  }
  const args = model.status?.args;
  if (Array.isArray(args)) {
    if (args.includes("--mmproj")) return true;
    const vIdx = args.indexOf("--vision");
    if (vIdx !== -1) {
      // "--vision no" ise gorsel yok; "gpu"/"cpu" veya bayrak tek basina ise var
      const val = args[vIdx + 1];
      return val !== "no";
    }
  }
  return false;
}

/**
 * Modelin gercek context boyutunu bulur.
 * Sira: status.args (--ctx-size llama.cpp, --max-context Strata)
 *       -> meta.n_ctx (Strata yeni) -> context_length -> varsayilan
 */
function extractContextWindow(model: RawModel): number {
  const args = model.status?.args;
  if (Array.isArray(args)) {
    // 1. llama.cpp: --ctx-size
    const ctxIdx = args.indexOf("--ctx-size");
    if (ctxIdx !== -1 && ctxIdx + 1 < args.length) {
      const val = parseInt(args[ctxIdx + 1], 10);
      if (Number.isFinite(val) && val > 0) return val;
    }
    // 2. Strata: --max-context
    const maxCtxIdx = args.indexOf("--max-context");
    if (maxCtxIdx !== -1 && maxCtxIdx + 1 < args.length) {
      const val = parseInt(args[maxCtxIdx + 1], 10);
      if (Number.isFinite(val) && val > 0) return val;
    }
  }
  // 3. Strata yeni format: meta.n_ctx
  if (model.meta?.n_ctx && typeof model.meta.n_ctx === "number") {
    return model.meta.n_ctx;
  }
  // 4. Standart OpenAI: context_length
  if (typeof model.context_length === "number" && model.context_length > 0) {
    return model.context_length;
  }
  // 5. Varsayilan
  return DEFAULT_CONTEXT_WINDOW;
}

/** providers.json'u aday konumlarda ara; ilk gecerli olan kazanir. */
function loadTargets(): Target[] {
  const extDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PI_PICODING_PROVIDERS_JSON,
    path.resolve(process.cwd(), "providers.json"),
    path.join(os.homedir(), ".pi", "agent", "providers.json"),
    // picoding/.pi/extensions -> picoding/providers.json
    path.resolve(extDir, "..", "..", "providers.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
      const list = Array.isArray(raw?.providers) ? raw.providers : null;
      if (!list) continue;
      const targets: Target[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (item.enabled === false) continue;
        const id = String(item.id || "").trim();
        let base = String(item.baseUrl || "").trim().replace(/\/+$/, "");
        // /v1 veya /models ile yazilmis URL'leri sade base'e indirge
        base = base.replace(/\/v1\/(chat\/completions|models).*$/, "").replace(/\/v1$/, "").replace(/\/models$/, "").replace(/\/chat\/completions.*$/, "");
        if (!id || !/^https?:\/\//i.test(base)) continue;
        const key = String(item.apiKey || "").trim();
        targets.push({ providerId: id, baseUrl: base, apiKey: key });
      }
      if (targets.length) {
        console.log(`[auto-model-discovery] providers.json okundu (${p}): ${targets.length} aktif provider`);
        return targets;
      }
    } catch (error) {
      console.warn(`[auto-model-discovery] providers.json okunamadi (${p}): ${error}`);
    }
  }
  console.log("[auto-model-discovery] providers.json bulunamadi; sabit varsayilan hedefler kullaniliyor.");
  return FALLBACK_TARGETS;
}

async function discoverFromTarget(pi: ExtensionAPI, target: Target): Promise<void> {
  const base = target.baseUrl;

  const headers: Record<string, string> = {};
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;

  const response = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(8000) });

  if (!response.ok) {
    console.warn(`[auto-model-discovery] ${base} yanit vermedi: ${response.status}`);
    return;
  }

  const payload = (await response.json()) as { data: RawModel[] };

  if (!payload.data || payload.data.length === 0) {
    console.warn(`[auto-model-discovery] Model listesi bos (${base}).`);
    return;
  }

  const models = payload.data.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    reasoning: false,
    input: extractVision(model) ? (["text", "image"] as const) : (["text"] as const),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: extractContextWindow(model),
    maxTokens: 4096,
  }));

  pi.registerProvider(target.providerId, {
    baseUrl: `${base}/v1`,
    apiKey: target.apiKey || "local-key",
    api: "openai-completions",
    models: models,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  });

  const detail = models.map((m) => `${m.id}(ctx=${m.contextWindow}${(m.input as readonly string[]).includes("image") ? ", vision" : ""})`).join(", ");
  console.log(
    `[auto-model-discovery] ${target.providerId}: ${models.length} model yuklendi: ${detail}`
  );
}

export default async function (pi: ExtensionAPI) {
  for (const target of loadTargets()) {
    try {
      await discoverFromTarget(pi, target);
    } catch (error) {
      // Bir sunucuya ulasilamazsa digerini denemeye devam et
      console.error(`[auto-model-discovery] Hata (${target.baseUrl}): ${error}`);
    }
  }
}
