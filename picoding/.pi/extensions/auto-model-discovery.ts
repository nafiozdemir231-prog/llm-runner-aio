/**
 * auto-model-discovery.ts
 * -----------------------
 * pi baslatildiginda yerel servisleri yoklar ve kayit eder:
 *   1) localhost:1234 -> "local-openai" provider'i (LM Studio, llama.cpp, Ollama, vLLM vb.)
 *   2) Strata gateway -> "strata" provider'i (varsayilan port 1235).
 *      API key Strata/local/models.json'dan okunur; bos ise ansikiz mod ile key'siz denenir.
 *
 * Kurulum:
 *   settings.json -> extensions: ["../.pi/extensions/auto-model-discovery.ts"]
 *   Servisler kapaliysa ilgili provider sadece atlanir; pi normal calismaya devam eder.
 *   Port/env asiri: PI_LOCAL_OPENAI_URL, PI_STRATA_PORT, PI_STRATA_MODELS_JSON
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModelLike = { id: string; name?: string; meta?: Record<string, any> };

function baseModels(data: ModelLike[] | undefined) {
  return (data ?? []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(model.meta?.max_context) || 131072,
    maxTokens: 8192,
  }));
}

/** Strata/local/models.json'u bul: once cwd (pi repodan calistiriliyorsa), sonra extension yoluna gore. */
function readStrataSettings(): { port: number; apiKey: string } | null {
  const candidates = [
    process.env.PI_STRATA_MODELS_JSON,
    path.resolve(process.cwd(), "Strata", "local", "models.json"),
    // picoding/.pi/extensions -> repo koku
    path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "Strata", "local", "models.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const s = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
      return { port: Number(s.port) || 1235, apiKey: String(s.api_key || "").trim() };
    } catch {}
  }
  return null;
}

async function fetchJson(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<any> {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function registerLocalOpenai(pi: ExtensionAPI) {
  const url = process.env.PI_LOCAL_OPENAI_URL || "http://localhost:1234";
  try {
    const payload = await fetchJson(`${url}/v1/models`);
    const models = baseModels(payload.data);
    if (!models.length) return console.warn("[auto-model-discovery] local-openai: model listesi bos.");
    pi.registerProvider("local-openai", {
      baseUrl: `${url}/v1`,
      apiKey: "local-key",
      api: "openai-completions",
      models,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    });
    console.log(`[auto-model-discovery] local-openai ${models.length} model (${url}): ${models.map((m) => m.id).join(", ")}`);
  } catch (error) {
    console.warn(`[auto-model-discovery] local-openai (${url}) yok sayildi: ${error}`);
  }
}

async function registerStrata(pi: ExtensionAPI) {
  const cfg = readStrataSettings();
  const port = Number(process.env.PI_STRATA_PORT) || cfg?.port || 1235;
  const apiKey = cfg?.apiKey || ""; // bos -> ansikiz mod: gateway key istemez
  try {
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const payload = await fetchJson(`http://127.0.0.1:${port}/v1/models`, { headers });
    const models = baseModels(payload.data);
    if (!models.length) return console.warn("[auto-model-discovery] strata: model listesi bos.");
    pi.registerProvider("strata", {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: apiKey || "unused", // key bos ise gateway her Authorization basligini kabul eder
      api: "openai-completions",
      models,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    });
    console.log(`[auto-model-discovery] strata ${models.length} model (port ${port}, ${apiKey ? "api key" : "ansikiz"}): ${models.map((m) => m.id).join(", ")}`);
  } catch (error) {
    console.warn(`[auto-model-discovery] strata (port ${port}) yok sayildi: ${error}`);
  }
}

export default async function (pi: ExtensionAPI) {
  await Promise.allSettled([registerLocalOpenai(pi), registerStrata(pi)]);
}
