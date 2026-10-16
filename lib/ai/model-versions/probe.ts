import { z } from "zod";

import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";
import { truncate } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import {
  pinnedModelFor,
  UTILITY_EFFORT,
  UTILITY_SEARCH_EFFORT,
  type AIModel,
} from "@/lib/ai/models";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import type {
  AiCallStatus,
  AnalysisRequest,
  AnalysisResult,
} from "@/lib/ai/providers/types";
import { ALLOWED_DOMAINS } from "@/lib/providers/news/allowed-domains";

// Sondagem de uma versão nova antes de adotar (ADR 0062, PLAN-608 §5.6 + S6). Vai pelo
// adapter Anthropic CRU (nunca pelo wrapper de versões adotadas, que trocaria o
// modelo) com o MESMO corpo de produção (buildAnthropicRequest: thinking adaptive,
// tool_choice auto, effort explícito). Cada chamada loga em ai_calls sem usuário e sem
// jogo (CHECKs ai_calls_*_system_only aceitam `model_probe_*`), com o custo pelo preço
// herdado da conferida. Uma sondagem só não reprova (runStep): o erro de conteúdo é
// repetido, e a rejeição é contraprovada na conferida, também logada.

export const PROBE_PROMPT_VERSION = "model_probe_v1";
export const PROBE_SEARCH_PROMPT_VERSION = "model_probe_search_v1";

const PROBE_MAX_TOKENS = 2048;
const PROBE_SEARCH_MAX_TOKENS = 4096;
const PROBE_TOOL_NAME = "submit_probe";

const PROBE_TOOL = {
  name: PROBE_TOOL_NAME,
  description: "Envia a resposta numérica da conta.",
  inputSchema: {
    type: "object",
    properties: { answer: { type: "integer", description: "O resultado da conta." } },
    required: ["answer"],
    additionalProperties: false,
  },
};

const ProbeAnswerSchema = z.object({ answer: z.number().int() });

export type ProbeOutcome =
  | { kind: "pass"; aiCallId: string | null }
  // Reprovação: a conferida passou no mesmo pedido que a versão teve rejeitado, ou a
  // versão errou o conteúdo (tool ausente, saída inválida, resposta errada, recusa,
  // sem busca na web no Haiku) duas vezes seguidas.
  | { kind: "fail"; reason: string; aiCallId: string | null }
  // Erro transitório (timeout, 429, 5xx, rede, ou rejeição que a conferida também
  // sofreu): tenta de novo amanhã; o N5 (7 dias) cuida de quem não sai disso.
  | { kind: "transient"; reason: string; aiCallId: string | null };

// Veredito de UMA chamada. `rejection` (400/403/404) e `content` não reprovam sozinhos:
// um 400 pode ser crédito esgotado e um 403, permissão da conta; e a dedup por versão
// (S3) nunca mais revisita uma reprovada, então uma sondagem só não pode condenar.
type StepVerdict =
  | { kind: "pass"; aiCallId: string | null }
  | { kind: "rejection"; reason: string; aiCallId: string | null }
  | { kind: "content"; reason: string; aiCallId: string | null }
  | { kind: "transient"; reason: string; aiCallId: string | null };

type ProbeStep = (
  model: AIModel,
  deadlineAt: number | undefined,
) => Promise<StepVerdict>;

async function logProbeCall(args: {
  model: AIModel;
  promptVersion: string;
  result: AnalysisResult;
  status: AiCallStatus;
  errorMessage: string | null;
}): Promise<string | null> {
  const r = args.result;
  const cost = calculateCost({
    model: args.model,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
  });
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: null,
        matchId: null,
        provider: anthropicProvider.providerKey,
        model: args.model.id,
        promptVersion: args.promptVersion,
        inputPayload: r.inputPayload,
        outputPayload: r.outputPayload,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        latencyMs: r.latencyMs,
        costUsd: cost.toFixed(6),
        status: args.status,
        errorMessage:
          args.errorMessage === null ? null : truncate(args.errorMessage, 2000),
      })
      .returning({ id: aiCalls.id });
    return row?.id ?? null;
  } catch (err) {
    // Mesmo swallow do persistAiCallError: a auditoria que falha não decide a sondagem.
    console.error(
      JSON.stringify({
        scope: "model_probe",
        error: "ai_call_audit_insert_failed",
        model: args.model.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

// Falha do adapter → rejeição, recusa (conteúdo) ou transitória (o resto).
function failureVerdict(
  r: Extract<AnalysisResult, { ok: false }>,
  aiCallId: string | null,
): StepVerdict {
  if (r.rejection) {
    return {
      kind: "rejection",
      reason: `a API recusou o pedido (${r.rejection}): ${r.message}`,
      aiCallId,
    };
  }
  if (r.refusal) {
    return { kind: "content", reason: `o modelo recusou: ${r.message}`, aiCallId };
  }
  return { kind: "transient", reason: `${r.status}: ${r.message}`, aiCallId };
}
const probeToolCall: ProbeStep = async (model, deadlineAt) => {
  const request: AnalysisRequest = {
    model,
    system:
      "Você é um verificador. Responda SEMPRE chamando a ferramenta submit_probe.",
    userMessage: "Quanto é 2 + 3? Responda chamando a ferramenta submit_probe.",
    tool: PROBE_TOOL,
    toolName: PROBE_TOOL_NAME,
    maxTokens: PROBE_MAX_TOKENS,
    effort: UTILITY_EFFORT,
    deadlineAt,
  };
  const r = await anthropicProvider.runAnalysis(request);
  if (!r.ok) {
    const id = await logProbeCall({
      model,
      promptVersion: PROBE_PROMPT_VERSION,
      result: r,
      status: r.status,
      errorMessage: r.message,
    });
    return failureVerdict(r, id);
  }
  if (r.toolInput === undefined) {
    const reason = `não chamou ${PROBE_TOOL_NAME} (stop_reason=${r.stopReason ?? "?"})`;
    const id = await logProbeCall({
      model,
      promptVersion: PROBE_PROMPT_VERSION,
      result: r,
      status: "tool_missing",
      errorMessage: reason,
    });
    return { kind: "content", reason, aiCallId: id };
  }
  const parsed = ProbeAnswerSchema.safeParse(r.toolInput);
  if (!parsed.success || parsed.data.answer !== 5) {
    const reason = parsed.success
      ? `resposta errada (${parsed.data.answer})`
      : `saída inválida: ${JSON.stringify(parsed.error.issues)}`;
    const id = await logProbeCall({
      model,
      promptVersion: PROBE_PROMPT_VERSION,
      result: r,
      status: "invalid_output",
      errorMessage: reason,
    });
    return { kind: "content", reason, aiCallId: id };
  }
  const id = await logProbeCall({
    model,
    promptVersion: PROBE_PROMPT_VERSION,
    result: r,
    status: "ok",
    errorMessage: null,
  });
  return { kind: "pass", aiCallId: id };
};

// S6: o Haiku é o modelo de notícias e cartões, que buscam na web. Mesmo formato
// desses caminhos (effort medium, allowed_domains, max_uses 1); passa só se veio um
// bloco `web_search_tool_result`. Opus e Sonnet não buscam em produção.
const probeWebSearch: ProbeStep = async (model, deadlineAt) => {
  const request: AnalysisRequest = {
    model,
    system:
      "Você é um assistente de pesquisa. Use a ferramenta de web search; não responda de memória.",
    userMessage:
      "Busque na web uma notícia recente de futebol e diga o título em uma frase.",
    tool: { name: "probe_noop", inputSchema: { type: "object" } },
    toolName: "probe_noop",
    maxTokens: PROBE_SEARCH_MAX_TOKENS,
    effort: UTILITY_SEARCH_EFFORT,
    serverTool: {
      kind: "web_search",
      allowedDomains: [...ALLOWED_DOMAINS],
      maxUses: 1,
    },
    deadlineAt,
  };
  const r = await anthropicProvider.runAnalysis(request);
  if (!r.ok) {
    const id = await logProbeCall({
      model,
      promptVersion: PROBE_SEARCH_PROMPT_VERSION,
      result: r,
      status: r.status,
      errorMessage: r.message,
    });
    return failureVerdict(r, id);
  }
  const searched = (r.contentBlocks ?? []).some(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: unknown }).type === "web_search_tool_result",
  );
  if (!searched) {
    const reason = "não buscou na web (sem bloco web_search_tool_result)";
    const id = await logProbeCall({
      model,
      promptVersion: PROBE_SEARCH_PROMPT_VERSION,
      result: r,
      status: "tool_missing",
      errorMessage: reason,
    });
    return { kind: "content", reason, aiCallId: id };
  }
  const id = await logProbeCall({
    model,
    promptVersion: PROBE_SEARCH_PROMPT_VERSION,
    result: r,
    status: "ok",
    errorMessage: null,
  });
  return { kind: "pass", aiCallId: id };
};

/**
 * Um passo da sondagem, com as contraprovas:
 *  - erro de conteúdo → repete uma vez na versão; só o 2º erro seguido reprova;
 *  - rejeição → o MESMO pedido na conferida (adapter cru, logado igual): a conferida
 *    passou → reprova; a conferida também falhou → transitório (conta, crédito);
 *  - transitório → transitório.
 * O `aiCallId` é o da chamada da versão que decidiu (nunca o da conferida).
 */
async function runStep(
  step: ProbeStep,
  model: AIModel,
  deadlineAt: number | undefined,
): Promise<ProbeOutcome> {
  let verdict = await step(model, deadlineAt);
  if (verdict.kind === "content") {
    const first = verdict;
    verdict = await step(model, deadlineAt);
    if (verdict.kind === "content") {
      return {
        kind: "fail",
        reason: `${first.reason}; 2ª tentativa: ${verdict.reason}`,
        aiCallId: verdict.aiCallId,
      };
    }
  }
  if (verdict.kind !== "rejection") return verdict;
  const control = await step(pinnedModelFor(model.family), deadlineAt);
  if (control.kind === "pass") {
    return {
      kind: "fail",
      reason: `${verdict.reason}, e a conferida passou`,
      aiCallId: verdict.aiCallId,
    };
  }
  return {
    kind: "transient",
    reason: `${verdict.reason}; a conferida também falhou (${control.reason})`,
    aiCallId: verdict.aiCallId,
  };
}

/**
 * Sonda a versão: a chamada de tool (todas as famílias) e, no Haiku, a busca na web.
 * O `aiCallId` devolvido é o da chamada que decidiu (a última da versão). No pior
 * caso são 3 chamadas curtas por passo (6 no Haiku): centavos, e só com versão nova.
 */
export async function probeModelVersion(
  model: AIModel,
  deadlineAt?: number,
): Promise<ProbeOutcome> {
  const tool = await runStep(probeToolCall, model, deadlineAt);
  if (tool.kind !== "pass" || model.family !== "haiku") return tool;
  return runStep(probeWebSearch, model, deadlineAt);
}
