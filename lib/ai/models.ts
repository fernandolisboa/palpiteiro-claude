// Registry tipado dos modelos de análise selecionáveis. ÚNICA fonte dos ids
// e pricing de modelo — nada de strings de modelo soltas espalhadas pelo código
// (CLAUDE.md). Cada consumidor (predict, cost, UI, server actions) resolve daqui.
//
// `thinkingMode` codifica a divergência crítica da API Anthropic: Opus 4.8 e
// Sonnet 4.6 usam ADAPTIVE THINKING (Opus 4.8 inclusive REJEITA 400 em
// `temperature`/`top_p`/`top_k`); Sonnet 4.5 não tem adaptive thinking e roda
// com `temperature`. A construção da request é model-aware em
// lib/ai/request-builder.ts a partir deste campo.

export type AIModelId =
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5";

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
  // Audiência: `true` = visível/escolhível pelo usuário comum; `false` =
  // admin-only (ADR 0013). O default global e a preferência do usuário comum só
  // aceitam modelos userSelectable; admin enxerga todos.
  userSelectable: boolean;
};

// ORDEM = capacidade decrescente (Opus > Sonnet 4.6 > Sonnet 4.5 > Haiku). A UI
// DEPENDE desta ordem: SELECTABLE_MODELS e modelsForAudience preservam a ordem de
// inserção do objeto, então é ela que rege os dropdowns. Não reordene sem querer
// mexer no que aparece nos seletores.
export const MODEL_REGISTRY: Record<AIModelId, AIModel> = {
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    thinkingMode: "adaptive",
    userSelectable: true,
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    // Sonnet 4.6 suporta adaptive thinking (recomendado pela Anthropic) — reusa
    // o mesmo caminho do Opus 4.8 no request-builder, sem `temperature`.
    thinkingMode: "adaptive",
    userSelectable: true,
  },
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5",
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    thinkingMode: "temperature",
    temperature: 0.3,
    // Selecionável como padrão global e preferência do usuário comum (#240): o
    // dono decidiu liberar AMBOS os Sonnets. Após esta promoção + a remoção do
    // Fable, NENHUM modelo do registry é admin-only (`userSelectable: false`).
    userSelectable: true,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5 (econômico)",
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    thinkingMode: "temperature",
    temperature: 0.3,
    userSelectable: true,
  },
};

// Default global de fallback terminal da cascata (predict.ts) e seed do INSERT
// de ai_config. Sonnet 4.5 (ADR 0021, #203): caminho `temperature` (reproduzível,
// ~40% mais barato que Opus) e `userSelectable: true` — satisfaz a invariante do
// ADR 0013 (o default vale pra TODOS, então tem que passar o gate de audiência).
// O default em RUNTIME é a row ai_config.id=1 (migration 0032); esta constante só
// entra quando a row falta/é inválida. Trocar aqui exige atualizar models.test.ts
// (sentinel) + a row persistida (migration), senão prod não muda.
export const DEFAULT_MODEL_ID: AIModelId = "claude-sonnet-4-5-20250929";

export const SELECTABLE_MODELS: AIModel[] = Object.values(MODEL_REGISTRY);

// Valida strings não-confiáveis (FormData / coluna text do DB) contra o registry.
export function isAIModelId(v: string): v is AIModelId {
  return v in MODEL_REGISTRY;
}

// Lista de modelos por audiência (ADR 0013): admin enxerga todos; usuário comum
// só os userSelectable. Usada pela UI e revalidada no servidor.
export function modelsForAudience(isAdmin: boolean): AIModel[] {
  return isAdmin
    ? SELECTABLE_MODELS
    : SELECTABLE_MODELS.filter((m) => m.userSelectable);
}

// Invariante de gating (ADR 0013): um modelo admin-only NUNCA é permitido pra
// audiência de usuário comum. Type guard pra usar o id já validado a seguir.
export function isModelAllowedForAudience(
  id: string,
  isAdmin: boolean,
): id is AIModelId {
  if (!isAIModelId(id)) return false;
  return isAdmin || MODEL_REGISTRY[id].userSelectable;
}
