// Registry tipado dos modelos de análise selecionáveis. ÚNICA fonte dos ids
// e pricing de modelo — nada de strings de modelo soltas espalhadas pelo código
// (CLAUDE.md). Cada consumidor (predict, cost, UI, server actions) resolve daqui.
//
// `thinkingMode` codifica a divergência crítica da API Anthropic: o modo
// ADAPTIVE THINKING (modelos que REJEITAM 400 em `temperature`/`top_p`/`top_k`,
// em `budget_tokens`, e — Opus 5.5 / Fable 5.1 — em thinking desligado e em
// `tool_choice` forçado) vs. o modo `temperature` (reproduzível). A construção da
// request é model-aware em lib/ai/providers/anthropic/request-builder.ts a partir
// deste campo.
//
// #524: os adaptive VOLTARAM (Fable 5.1 admin-only; Opus 5.5 e Sonnet 5
// selecionáveis por QUALQUER usuário). No motor "Código + JEV" (ADR 0041) a DECISÃO
// é código determinístico e o LLM só narra, então o motivo do ADR 0021 pra manter só
// modelos `temperature` não vale lá. No motor `llm` (o default) eles seguem
// não-reproduzíveis, inclusive pra usuário comum que escolher Opus 5.5 / Sonnet 5 —
// trade-off aceito na emenda do ADR 0021: o default global continua Sonnet 4.5
// (temperature) e o Yield segue segmentável por `predictions.modelVersion`.
//
// O registry segue CURADO à mão: a Models API da Anthropic (GET /v1/models) não
// devolve pricing, então um modelo novo só entra aqui com o preço oficial. O
// /admin/settings avisa quando a API lista um id `claude-*` ainda sem cadastro
// (lib/ai/providers/anthropic/models-catalog.ts).

// Provider de IA que atende um modelo (ADR 0027). União FECHADA: um provider novo
// é uma edição aqui + um adapter no seam. Validado contra strings não-confiáveis
// por isAIProvider (espelha isAIModelId).
export type AIProviderKey = "anthropic" | "openai";

export type AIModelId =
  | "claude-fable-5-1"
  | "claude-opus-5-5"
  | "claude-sonnet-5"
  | "claude-sonnet-4-5-20250929"
  | "claude-haiku-4-5";

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

// ORDEM = capacidade decrescente (Fable 5.1 > Opus 5.5 > Sonnet 5 > Sonnet 4.5 >
// Haiku). A UI DEPENDE desta ordem: SELECTABLE_MODELS e modelsForAudience preservam
// a ordem de inserção do objeto, então é ela que rege os dropdowns. O default
// (Sonnet 4.5) NÃO é o primeiro — ele vem de DEFAULT_MODEL_ID / ai_config, não da
// posição. Não reordene sem querer mexer no que aparece nos seletores.
export const MODEL_REGISTRY: Record<AIModelId, AIModel> = {
  // Adaptive (#524). Thinking sempre ligado: omitir ou `adaptive`; `disabled` e
  // `budget_tokens` dão 400, sampling params dão 400, tool_choice forçado dá 400,
  // sem prefill. Pode devolver `stop_reason: "refusal"` (tratado no adapter).
  // ADMIN-ONLY: o mais caro do registry ($10/$50).
  "claude-fable-5-1": {
    id: "claude-fable-5-1",
    provider: "anthropic",
    label: "Fable 5.1",
    inputPricePerMTok: 10,
    outputPricePerMTok: 50,
    thinkingMode: "adaptive",
    userSelectable: false,
  },
  // Adaptive (#524). Thinking não desliga (disabled/budget_tokens = 400), sem
  // sampling, tool_choice forçado = 400, sem prefill. Effort default do servidor é
  // `medium` — mandamos o effort do ai_config explicitamente.
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    provider: "anthropic",
    label: "Opus 5.5",
    inputPricePerMTok: 4,
    outputPricePerMTok: 20,
    thinkingMode: "adaptive",
    userSelectable: true,
  },
  // Adaptive (#524). Aceita thinking disabled e tool_choice forçado, mas com
  // thinking ligado usamos `auto` (o mesmo caminho adaptive dos outros). Sem
  // sampling nem budget_tokens.
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Sonnet 5",
    inputPricePerMTok: 2,
    outputPricePerMTok: 10,
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
    // Default global + selecionável pelo usuário comum (#240/#203).
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
  // Seam OpenAI (ADR 0027) permanece RETIDO no código (AIProviderKey, PROVIDERS,
  // openaiProvider, isAIProvider, providerHasKey) — mas SEM modelo de registry
  // após #374 (o gpt-5-mini de prova foi removido). Um provider novo reentra via
  // uma entrada de registry aqui + adapter no seam, sem ressuscitar código.
};

// Modelo de JULGAMENTOS (ADR 0041): o JEV da TypeSafe fica FORA do MODEL_REGISTRY
// de propósito — o registry é de LLMs selecionáveis com tool calling (thinkingMode,
// temperature, audiência), e o JEV não é escolhível nem gera texto. Pinado na versão
// (nunca `jev-latest`: o alias move e muda as respostas); upgrade = bump deliberado
// + re-backtest. Preço oficial por 1M de tokens de input; output é grátis.
export const JUDGMENT_MODEL_ID = "jev-1.13.0";
// Gravado em ai_calls.provider nas chamadas JEV. Fora de AIProviderKey de propósito:
// o JEV não é um AIProvider (seam próprio, ADR 0041 §5).
export const JUDGMENT_PROVIDER_KEY = "typesafe";
export const TYPESAFE_PRICE_PER_MTOK_INPUT = 0.042;

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
