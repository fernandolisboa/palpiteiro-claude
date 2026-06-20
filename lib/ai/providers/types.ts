// O seam `AIProvider` — a ÚNICA fronteira entre predict.ts e qualquer SDK de IA
// (ADR 0027). Este arquivo NÃO importa `@anthropic-ai/sdk` (nem `import type`): o
// `ToolDef` neutro substitui `Anthropic.Tool` na fronteira. predict orquestra; o
// adapter (`lib/ai/providers/<provider>/`) fala com o vendor. Zod e o logging em
// `ai_calls` ficam em predict — o adapter devolve `toolInput` CRU.

import type { Effort } from "@/lib/ai/generation-params";
import type { AIModel } from "@/lib/ai/models";

// Os status reais — espelham `aiCallStatusEnum` (db/schema.ts). União FECHADA: um
// provider novo NÃO adiciona status. `fidelity_divergence` (#380) é emitido SÓ pelo
// generator de palpites (não por providers — fica fora do Exclude<> de erro do adapter
// abaixo, junto de ok/invalid_output/tool_missing, que também não são donos de provider).
export type AiCallStatus =
  | "ok"
  | "invalid_output"
  | "provider_error"
  | "timeout"
  | "tool_missing"
  | "rate_limited"
  | "fidelity_divergence";

// Tool definition provider-neutra. `Anthropic.Tool` é `{name, description,
// input_schema}`; OpenAI (#231) é `{type:"function", function:{name, parameters,
// strict}}`. O cartucho carrega o JSON-Schema canônico e cada ADAPTER down-mapeia.
export type ToolDef = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

// SERVER-TOOL aditivo, opt-in (ADR 0032, #377). É a porta pra ferramentas
// EXECUTADAS NO SERVIDOR da Claude (web search) — distinta do `tool`/`toolName`
// forçado (submit_palpite/submit_prediction). `serverTool` PRESENTE ⇒ o adapter
// entra no ramo server-tool (tool_choice:auto, sem forçar o submit); AUSENTE (todo
// caller de hoje) ⇒ caminho forçado BYTE-IDÊNTICO (preserva os golden tests). Só o
// adapter Anthropic implementa; o OpenAI rejeita com provider_error (news só roteia
// pra Anthropic).
export type ServerToolDef = {
  kind: "web_search";
  // Curadoria de domínios (ADR 0032 §3) — restringe a busca a fontes reputadas.
  allowedDomains?: string[];
  // Teto de buscas por chamada (ADR 0032 §4) — custo metered, limitado por construção.
  maxUses?: number;
};

// O que predict entrega ao seam (substitui os args de `buildAnthropicRequest`).
// Tudo já é provider-neutro em predict hoje. O MAPEAMENTO de `effort`/`temperature`
// pros campos do request (adaptive→thinking / temperature→forced-tool; modelos de
// raciocínio rejeitam `temperature`) é per-adapter, keyed por `model.thinkingMode`
// — NUNCA re-derivado em predict.
export type AnalysisRequest = {
  model: AIModel;
  system: string;
  userMessage: string;
  tool: ToolDef;
  toolName: string;
  maxTokens: number;
  effort?: Effort;
  temperature?: number;
  // ADITIVO opt-in (ADR 0032, #377). Presente ⇒ o adapter Anthropic usa a server
  // tool (web search, tool_choice:auto) em vez de forçar o `tool`. Ausente (todo
  // caller de hoje) ⇒ caminho forçado byte-idêntico. `tool`/`toolName` ainda são
  // REQUIRED no shape — no modo server-tool o adapter os IGNORA (não há submit forçado).
  serverTool?: ServerToolDef;
};

// Uso provider-neutro. Os ÚNICOS dois campos consumidos hoje (→ `calculateCost` +
// `ai_calls.inputTokens/outputTokens`, integer NOT NULL). O ADAPTER DEVE coagir a
// inteiro finito ≥0 antes de devolver, pra um campo ausente/ambíguo do vendor nunca
// fazer `calculateCost` devolver NaN (`costUsd` é numeric NOT NULL).
export type AnalysisUsage = {
  inputTokens: number;
  outputTokens: number;
};

// Sucesso: `toolInput` CRU (`unknown` — Zod roda em predict contra
// `cartridge.outputSchema`, NUNCA no adapter). `toolInput === undefined` é o "o
// modelo não chamou o tool" neutro → predict levanta `tool_missing`.
// `inputPayload`/`outputPayload` vão verbatim pro `ai_calls` jsonb (o adapter
// Anthropic os mantém byte-idênticos ao de hoje). `latencyMs` medido pelo adapter
// (span TIGHT ao redor SÓ da chamada paga).
export type AnalysisOk = {
  ok: true;
  // `toolInput` é `unknown`; `undefined` ⇒ predict trata como `tool_missing`.
  toolInput: unknown;
  usage: AnalysisUsage;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  stopReason: string | null;
  latencyMs: number;
  // ADITIVO opt-in (ADR 0032, #377). Só populado no modo server-tool: os blocos de
  // conteúdo CRUS da resposta final (após resolver pause_turn), pra o provider de
  // notícias andar atrás dos `web_search_tool_result`. `undefined` no caminho forçado
  // (não toca os golden tests). O adapter NÃO interpreta — devolve verbatim.
  contentBlocks?: unknown[];
};

// Falha: o adapter CLASSIFICA o PRÓPRIO erro de SDK num SUBCONJUNTO de
// `AiCallStatus`. O `Exclude<>` torna ERRO DE TIPO um adapter emitir
// `ok`/`invalid_output`/`tool_missing`/`fidelity_divergence` — esses são donos do
// predict/generator, não do provider. `usage` é `{0,0}` quando nenhum corpo chegou.
// `cause` preserva o erro de SDK original pra `PredictError.cause`.
export type AnalysisErr = {
  ok: false;
  status: Exclude<
    AiCallStatus,
    "ok" | "invalid_output" | "tool_missing" | "fidelity_divergence"
  >;
  message: string;
  cause?: unknown;
  usage: AnalysisUsage;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  stopReason: string | null;
  latencyMs: number;
};

export type AnalysisResult = AnalysisOk | AnalysisErr;

// O contrato do provider (ADR 0027). `providerKey` é escrito verbatim em
// `ai_calls.provider`. `hasKey()` = padrão SportMonks/#227: `false` ⇒
// filtrado/inerte, nunca roteado (relevante a partir do #231; no #230 há só Anthropic).
export type AIProvider = {
  readonly providerKey: string;
  hasKey(): boolean;
  runAnalysis(request: AnalysisRequest): Promise<AnalysisResult>;
};
