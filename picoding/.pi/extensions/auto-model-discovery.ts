/**
 * auto-model-discovery.ts
 * -----------------------
 * http://localhost:1234/v1/models endpoint'inden modelleri otomatik çeker
 * ve pi'ya "local-openai" provider'ı olarak kaydeder.
 *
 * Kurulum:
 *   1. settings.json dosyasında extensions path'i ayarlı
 *   2. localhost:1234 açık olmalı (LM Studio, Ollama, vLLM vb.)
 *   3. pi başlatıldığında extension otomatik yüklenir
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  try {
    const response = await fetch("http://localhost:1234/v1/models");
    
    if (!response.ok) {
      console.warn(`[auto-model-discovery] localhost:1234 yanit vermedi: ${response.status}`);
      return;
    }

    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        name?: string;
        object?: string;
        created?: number;
        owned_by?: string;
      }>;
    };

    if (!payload.data || payload.data.length === 0) {
      console.warn("[auto-model-discovery] Model listesi bos.");
      return;
    }

    const models = payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }));

    pi.registerProvider("local-openai", {
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local-key",
      api: "openai-completions",
      models: models,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    });

    console.log(
      `[auto-model-discovery] ${models.length} model yuklendi: ${models.map(m => m.id).join(", ")}`
    );
  } catch (error) {
    console.error(`[auto-model-discovery] Hata: ${error}`);
  }
}
