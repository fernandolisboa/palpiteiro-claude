// Registry tipado dos modelos de análise selecionáveis. ÚNICA fonte dos ids
// e pricing de modelo — nada de strings de modelo soltas espalhadas pelo código
// (CLAUDE.md). Cada consumidor (predict, cost, UI, server actions) resolve daqui.
//
// `thinkingMode` codifica a divergência crítica da API Anthropic: Opus 4.8 usa
// ADAPTIVE THINKING e REJEITA (400) `temperature`/`top_p`/`top_k`; Sonnet 4.5
// ACEITA `temperature`. A construção da request é model-aware em
// lib/ai/request-builder.ts a partir deste campo.

export type AIModelId = "claude-opus-4-8" | "claude-sonnet-4-5-20250929";

export type AIModel = {
  id: AIModelId;
  label: string;
  // Pricing por 1M de tokens em USD (cache write/read omitidos — sem prompt
  // caching no MVP). Fonte: pricing oficial Anthropic.
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  thinkingMode: "adaptive" | "temperature";
  // Só relevante quando thinkingMode === "temperature".
  temperature?: number;
};

export const MODEL_REGISTRY: Record<AIModelId, AIModel> = {
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    thinkingMode: "adaptive",
  },
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5",
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    thinkingMode: "temperature",
    temperature: 0.3,
  },
};

// Default global de fallback (e seed da migration). Opus 4.8.
export const DEFAULT_MODEL_ID: AIModelId = "claude-opus-4-8";

export const SELECTABLE_MODELS: AIModel[] = Object.values(MODEL_REGISTRY);

// Valida strings não-confiáveis (FormData / coluna text do DB) contra o registry.
export function isAIModelId(v: string): v is AIModelId {
  return v in MODEL_REGISTRY;
}
