// Registry tipado dos modelos de análise selecionáveis. ÚNICA fonte dos ids
// e pricing de modelo — nada de strings de modelo soltas espalhadas pelo código
// (CLAUDE.md). Cada consumidor (predict, cost, UI, server actions) resolve daqui.
//
// ADR 0061 (#607): só Haiku, Sonnet e Opus 5.5. Os três são ADAPTIVE: thinking
// sempre disponível e controlado por `effort`, e a API REJEITA (400) `temperature`
// fora do default, `top_p`/`top_k`, `budget_tokens` e prefill; Opus 5.5 e Sonnet 5.5
// também rejeitam `tool_choice` forçado. Então todo modelo daqui usa o MESMO corpo de
// request (lib/ai/providers/anthropic/request-builder.ts): `thinking: adaptive`,
// `tool_choice: auto`, `effort` explícito. O antigo caminho `temperature` (Sonnet
// 4.5/Haiku 4.5, tool forçado) acabou com eles.
//
// O registry segue CURADO à mão e é a base CONFERIDA (preço oficial, sempre disponível
// como fallback). Versões mais novas de cada família entram sozinhas pelo banco (ADR
// 0062): o cron check-model-versions sonda e adota, e o seam troca a conferida pela
// adotada na hora da chamada (lib/ai/providers/adopted-versions.ts). Por isso o
// `label` daqui é o nome da FAMÍLIA, sem número: a versão concreta aparece no painel
// do admin e no rodapé da análise (formatModelName do id que serviu). Este arquivo
// NÃO importa `db`: componentes "use client" o importam.

// Provider de IA que atende um modelo (ADR 0027). União FECHADA: um provider novo
// é uma edição aqui + um adapter no seam. Validado contra strings não-confiáveis
// por isAIProvider (espelha isAIModelId).
export type AIProviderKey = "anthropic" | "openai";

export type AIModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

// Família do modelo (o nível de capacidade). É o eixo estável: as versões trocam,
// a família fica. Um id gravado de versão antiga é lido como o modelo atual da
// mesma família (resolveModelId).
export type ModelFamily = "opus" | "sonnet" | "haiku";

export type AIModel = {
  // `string`, não `AIModelId`: uma versão adotada (PLAN-608) tem id fora do registry.
  // Quem precisa do id conferido usa `PinnedModel`.
  id: string;
  // Provider que atende este modelo (ADR 0027): despacha o adapter no seam
  // (getProviderForModel) e é gravado em ai_calls.provider.
  provider: AIProviderKey;
  family: ModelFamily;
  label: string;
  // Pricing por 1M de tokens em USD (cache write/read omitidos — sem prompt
  // caching no MVP). Fonte: pricing oficial do provider.
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  // Tarifa de prompt longo: com mais de `aboveInputTokens` tokens de input, a
  // chamada inteira (input E output) é cobrada nesta tarifa. Só o Haiku 5.5 tem.
  longPromptPricing?: {
    aboveInputTokens: number;
    inputPricePerMTok: number;
    outputPricePerMTok: number;
  };
  // Ritmo pro orçamento de tempo do run (lib/ai/deadline.ts): `fast` responde em
  // segundos e cabe na reserva da síntese no fim do run; `deliberate` pensa antes
  // da tool call e precisa de uma janela grande pra valer a pena começar.
  speed: "fast" | "deliberate";
  // Audiência: `true` = visível/escolhível pelo usuário comum; `false` =
  // admin-only (ADR 0013). O default global e a preferência do usuário comum só
  // aceitam modelos userSelectable; admin enxerga todos. Hoje os três são
  // selecionáveis; o gate fica pra um modelo admin-only futuro.
  userSelectable: boolean;
  // Presente só numa versão adotada automaticamente (PLAN-608): o preço é herdado da
  // conferida da família até ser confirmado, e `pinnedId` é a conferida de fallback.
  adopted?: { priceEstimated: boolean; pinnedId: AIModelId };
};

// Modelo do registry estático: o id é um dos conferidos.
export type PinnedModel = AIModel & { id: AIModelId };

// ORDEM = capacidade decrescente (Opus > Sonnet > Haiku). A UI DEPENDE desta ordem:
// SELECTABLE_MODELS e modelsForAudience preservam a ordem de inserção do objeto,
// então é ela que rege os dropdowns. O default NÃO é o primeiro — ele vem de
// DEFAULT_MODEL_ID / ai_config, não da posição.
export const MODEL_REGISTRY: Record<AIModelId, PinnedModel> = {
  // Thinking não desliga (disabled = 400 em qualquer effort); effort default do
  // servidor é `medium`, por isso mandamos o effort do ai_config explicitamente.
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    provider: "anthropic",
    family: "opus",
    label: "Opus",
    inputPricePerMTok: 4,
    outputPricePerMTok: 20,
    speed: "deliberate",
    userSelectable: true,
  },
  // `disabled` dá 400 (o mínimo seria `between_tools`, que não usamos); effort
  // default `high`, com níveis recalibrados em relação ao Sonnet 5.
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    family: "sonnet",
    label: "Sonnet",
    inputPricePerMTok: 2,
    outputPricePerMTok: 10,
    speed: "deliberate",
    userSelectable: true,
  },
  // Pode recusar (`stop_reason: "refusal"`) e NÃO tem fallback server-side: nunca
  // mandar `fallbacks`. Thinking ligado por padrão (effort default `medium`); as
  // tarefas internas mandam effort baixo (UTILITY_EFFORT).
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    family: "haiku",
    label: "Haiku (econômico)",
    inputPricePerMTok: 0.1,
    outputPricePerMTok: 0.5,
    longPromptPricing: {
      aboveInputTokens: 100_000,
      inputPricePerMTok: 0.5,
      outputPricePerMTok: 2.5,
    },
    speed: "fast",
    userSelectable: true,
  },
  // Seam OpenAI (ADR 0027) permanece RETIDO no código (AIProviderKey, PROVIDERS,
  // openaiProvider, isAIProvider, providerHasKey) — mas SEM modelo de registry
  // após #374 (o gpt-5-mini de prova foi removido). Um provider novo reentra via
  // uma entrada de registry aqui + adapter no seam, sem ressuscitar código.
};

// O modelo atual de cada família. Fable e Mythos (acima do Opus) saíram do app de
// propósito (ADR 0061) e um id gravado deles é lido como o Opus.
const FAMILY_MODEL: Record<ModelFamily, AIModelId> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

export const FAMILY_LABEL: Record<ModelFamily, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

// A conferida da família: a base sempre disponível como fallback.
export function pinnedModelFor(family: ModelFamily): PinnedModel {
  return MODEL_REGISTRY[FAMILY_MODEL[family]];
}

export type ClaudeVersion = {
  family: ModelFamily;
  major: number;
  minor: number;
  snapshot: string | null;
};

// Versão de um id `claude-<família>-<major>[-<minor>][-<AAAAMMDD>]`, das três famílias
// do app. Minor ausente vale 0 (`claude-sonnet-6` = 6.0). Estrita de propósito: o
// formato antigo (`claude-3-5-haiku-…`), outras famílias (Fable, Mythos) e sufixos
// como `-preview` ficam de fora (null).
export function parseClaudeVersion(id: string): ClaudeVersion | null {
  const m = /^claude-(opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?:-(\d{8}))?$/.exec(id);
  if (!m) return null;
  return {
    family: m[1] as ModelFamily,
    major: Number(m[2]),
    minor: m[3] === undefined ? 0 : Number(m[3]),
    snapshot: m[4] ?? null,
  };
}

// Família de um id `claude-*` qualquer, inclusive os antigos (`claude-sonnet-4-5-20250929`,
// `claude-3-5-haiku-20241022`, `claude-fable-5-1`). `null` pra id que não é Claude.
export function claudeFamilyOf(
  id: string,
): ModelFamily | "fable" | "mythos" | null {
  const m = /^claude-(?:\d+(?:-\d+)?-)?(opus|sonnet|haiku|fable|mythos)(?:-|$)/.exec(id);
  return m ? (m[1] as ModelFamily | "fable" | "mythos") : null;
}

// Lê um id de modelo vindo de fonte não-confiável (coluna text do DB, FormData de uma
// aba aberta antes do deploy): id atual passa; id de versão antiga vira o modelo atual
// da MESMA família (Haiku 4.5 → Haiku 5.5, Sonnet 4.5/5 → Sonnet 5.5, Opus 4.x/Fable →
// Opus 5.5), sem reescrever o dado gravado. O histórico (predictions.modelVersion,
// ai_calls.model) não passa por aqui: continua mostrando o modelo que rodou de fato.
// Id desconhecido (lixo, gpt-5-mini antigo) → null, e o caller cai no default.
export function resolveModelId(raw: string | null | undefined): AIModelId | null {
  if (!raw) return null;
  if (isAIModelId(raw)) return raw;
  const family = claudeFamilyOf(raw);
  if (family === null) return null;
  return FAMILY_MODEL[family === "fable" || family === "mythos" ? "opus" : family];
}

// Modelo das tarefas internas baratas (manchete, parse de aposta, extração do Seu
// palpite, notícias, cartões): não seguem a preferência do usuário.
export const UTILITY_MODEL_ID: AIModelId = "claude-haiku-5-5";
// Effort das tarefas internas que só preenchem um tool (manchete, parse, extração):
// `low` pensa pouco e pula o thinking nas fáceis, o mais perto do Haiku 4.5 sem
// thinking. As que buscam na web usam `medium`: em `low` o modelo às vezes não busca.
export const UTILITY_EFFORT = "low" as const;
export const UTILITY_SEARCH_EFFORT = "medium" as const;

// Modelo de JULGAMENTOS (ADR 0041): o JEV da TypeSafe fica FORA do MODEL_REGISTRY
// de propósito — o registry é de LLMs selecionáveis com tool calling (família,
// ritmo, audiência), e o JEV não é escolhível nem gera texto. Pinado na versão
// (nunca `jev-latest`: o alias move e muda as respostas); upgrade = bump deliberado
// + re-backtest. Preço oficial por 1M de tokens de input; output é grátis.
export const JUDGMENT_MODEL_ID = "jev-1.13.0";
// Gravado em ai_calls.provider nas chamadas JEV. Fora de AIProviderKey de propósito:
// o JEV não é um AIProvider (seam próprio, ADR 0041 §5).
export const JUDGMENT_PROVIDER_KEY = "typesafe";
export const TYPESAFE_PRICE_PER_MTOK_INPUT = 0.042;

// Default global de fallback terminal da cascata (predict.ts) e seed do INSERT
// de ai_config. Sonnet 5.5 (ADR 0061): o meio-termo de custo, `userSelectable: true`
// — satisfaz a invariante do ADR 0013 (o default vale pra TODOS, então tem que passar
// o gate de audiência). O default em RUNTIME é a row ai_config.id=1, lida por
// resolveModelId (um id antigo gravado lá vira o 5.5 da mesma família); esta constante
// só entra quando a row falta/é inválida.
export const DEFAULT_MODEL_ID: AIModelId = "claude-sonnet-5-5";

export const SELECTABLE_MODELS: PinnedModel[] = Object.values(MODEL_REGISTRY);

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
export function modelsForAudience(isAdmin: boolean): PinnedModel[] {
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

// Escolha de modelo vinda do usuário (FormData do override por análise ou da
// preferência): um id de versão antiga, de uma aba aberta antes do deploy, vira o 5.5
// da mesma família (resolveModelId) e então passa pelo gate de audiência. Null =
// inválido ou fora da audiência.
export function modelChoiceForAudience(
  raw: string,
  isAdmin: boolean,
): AIModelId | null {
  const id = resolveModelId(raw);
  return id && isModelAllowedForAudience(id, isAdmin) ? id : null;
}
