// Registry tipado dos modelos de análise selecionáveis. ÚNICA fonte dos ids
// e pricing de modelo — nada de strings de modelo soltas espalhadas pelo código
// (CLAUDE.md). Cada consumidor (predict, cost, UI, server actions) resolve daqui.
//
// `thinkingMode` codifica a divergência crítica da API Anthropic: Opus 4.8 e
// Sonnet 4.6 usam ADAPTIVE THINKING (Opus 4.8 inclusive REJEITA 400 em
// `temperature`/`top_p`/`top_k`); Sonnet 4.5 não tem adaptive thinking e roda
// com `temperature`. A construção da request é model-aware em
// lib/ai/request-builder.ts a partir deste campo.

// Provider de IA que atende um modelo (ADR 0027). União FECHADA: um provider novo
// é uma edição aqui + um adapter no seam. Validado contra strings não-confiáveis
// por isAIProvider (espelha isAIModelId).
export type AIProviderKey = "anthropic" | "openai";

export type AIModelId =
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5"
  | "gpt-5-mini";

export type AIModel = {
  id: AIModelId;
  // Provider que atende este modelo (ADR 0027): despacha o adapter no seam
  // (getProviderForModel) e é gravado em ai_calls.provider.
  provider: AIProviderKey;
  label: string;
  // Pricing por 1M de tokens em USD (cache write/read omitidos — sem prompt
  // caching no MVP). Fonte: pricing oficial do provider.
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
    provider: "anthropic",
    label: "Opus 4.8",
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    thinkingMode: "adaptive",
    userSelectable: true,
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
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
    provider: "anthropic",
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
    provider: "anthropic",
    label: "Haiku 4.5 (econômico)",
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    thinkingMode: "temperature",
    temperature: 0.3,
    userSelectable: true,
  },
  // Provider de PROVA OpenAI (ADR 0027 / #231): admin-only + key-gated inerte
  // (sem OPENAI_API_KEY ⇒ filtrado, nunca roteado). APPEND no FIM — a ordem de
  // inserção rege os dropdowns (ver acima); manter as 4 posições Anthropic estáveis.
  "gpt-5-mini": {
    id: "gpt-5-mini",
    provider: "openai",
    label: "GPT-5 mini (OpenAI · admin)",
    // ⚠️ Pricing VERIFY-BEFORE-MERGE — developers.openai.com/api/docs/models/gpt-5-mini
    // (jun/2026: $0.25 in / $2.00 out por 1M tokens). costUsd é NOT NULL e
    // calculateCost depende disto; confirmar na página oficial antes de roteamento real.
    inputPricePerMTok: 0.25,
    outputPricePerMTok: 2.0,
    // gpt-5-mini é modelo de RACIOCÍNIO: o adapter OpenAI OMITE `temperature`
    // incondicionalmente (rejeitada, como o Opus). `thinkingMode` aqui é só
    // CLASSIFICAÇÃO (o replay-gate é Anthropic-only e cerca rows não-anthropic):
    // "temperature" = caminho ESTRITO por padrão (ADR 0027 — nunca "adaptive").
    thinkingMode: "temperature",
    // Admin-only de início (ADR 0013/0021): preserva a reprodutibilidade — só o dono,
    // via override, alcança. Promover exige ADR futuro (critério de saída A/B).
    userSelectable: false,
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

// Valida string não-confiável contra os providers conhecidos (ADR 0027) — gate no
// boundary de escrita de ai_calls.provider (que virou `text`), espelha isAIModelId.
export function isAIProvider(v: string): v is AIProviderKey {
  return v === "anthropic" || v === "openai";
}

// Chave do provider presente? (padrão SportMonks/#227, ADR 0026): sem chave ⇒
// provider INERTE (filtrado da seleção, nunca roteado). Lê o env no momento da
// chamada. Map INLINE aqui (não importa lib/ai/providers) pra manter o grafo de
// imports acíclico — o adapter tem o próprio hasKey pro caminho pago.
export function providerHasKey(provider: AIProviderKey): boolean {
  const ENV_BY_PROVIDER: Record<AIProviderKey, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  return Boolean(ENV_BY_PROVIDER[provider]);
}

// Lista de modelos por audiência (ADR 0013 + ADR 0027): além do gate de audiência
// (admin vê todos; usuário comum só userSelectable), filtra modelos cujo provider
// NÃO tem chave — um provider inerte (ex.: OpenAI sem OPENAI_API_KEY) some da
// seleção em TODAS as audiências. Usada pela UI e revalidada no servidor.
export function modelsForAudience(isAdmin: boolean): AIModel[] {
  const withKey = SELECTABLE_MODELS.filter((m) => providerHasKey(m.provider));
  return isAdmin ? withKey : withKey.filter((m) => m.userSelectable);
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
