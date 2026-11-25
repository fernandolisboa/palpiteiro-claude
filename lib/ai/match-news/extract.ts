import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { canFitCall } from "@/lib/ai/deadline";
import {
  MODEL_REGISTRY,
  UTILITY_EFFORT,
  UTILITY_MODEL_ID,
  isAIProvider,
  type AIModel,
} from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AiCallStatus, AnalysisRequest } from "@/lib/ai/providers/types";
import { ExtractEnvelopeSchema, normalizeClaimInput } from "@/lib/ai/user-palpite/extract";
import { db } from "@/lib/db";
import { NewsClaimSchema, NewsSourcesSchema, type NewsClaim } from "@/lib/match-news/types";
import { stripPlayerNames } from "@/lib/user-palpite/check-claims";
import type { TeamNames } from "@/lib/user-palpite/reading";
import { CLAIM_TEXT_MAX, ClaimSchema, MAX_CLAIMS } from "@/lib/user-palpite/types";

import {
  MATCH_NEWS_EXTRACT_TOOL_NAME,
  MATCH_NEWS_EXTRACT_VERSION,
  NEWS_EXTRACT_SYSTEM_PROMPT,
  buildNewsExtractUserMessage,
  newsExtractTool,
  prepareNewsLines,
  type NewsExtractItem,
} from "./extract-cartridge";

// Extração Haiku das notícias do jogo (#672, PLAN-672 §4) pelo seam AIProvider, com log
// em `ai_calls` — mesma disciplina de lib/ai/user-palpite/extract.ts (ADR 0036/0063):
// nunca SDK direto, nunca por predict.ts (não gera predição). Chamada de SISTEMA (cron
// da base): `user_id` null, aceito pelo CHECK só com prompt_version `match_news_*`.
// Roda uma vez por lote e fica guardada: a Haiku não é determinística.

const EXTRACT_MODEL = MODEL_REGISTRY[UTILITY_MODEL_ID];
// Folga pro thinking do Haiku 5.5, que conta dentro de max_tokens.
const EXTRACT_MAX_TOKENS = 4096;

export type NewsExtractResult =
  | { ok: true; claims: NewsClaim[]; warnings: string[]; aiCallId: string | null }
  // `deadline`: não coube no prazo da fase (sem chamada) ou o adapter estourou o tempo
  // com a chamada cortada pelo prazo da fase. O lote não vira `failed` e a tentativa não
  // conta. Timeout pelo teto da chamada (fase com folga) é `failed`: conta tentativa.
  | { ok: false; kind: "deadline" | "failed"; message: string; aiCallId: string | null };

/**
 * Da entrada crua da ferramenta às afirmações das notícias. PURO: o mesmo tool_use dá
 * sempre as mesmas afirmações. Por item: `sources` (ids N# do lote) separados e
 * conferidos contra os ids que o modelo viu; o resto passa por normalizeClaimInput →
 * ClaimSchema (o MESMO do contexto extra, com o superRefine). Tópico "form" é
 * descartado (o retrospecto é dado nosso). Teto de MAX_CLAIMS; nomes de jogador fora
 * das paráfrases. Tirar o nome alonga o texto ("Gabi" → "o jogador citado"): o texto é
 * cortado no teto e a afirmação final passa de novo pelo NewsClaimSchema, o MESMO da
 * leitura do lote, pra row gravada sempre voltar a ser lida.
 */
export function claimsFromNewsToolInput(
  toolInput: unknown,
  args: { teams: TeamNames; refs: readonly string[] },
): { ok: true; claims: NewsClaim[]; warnings: string[] } | { ok: false; message: string } {
  const envelope = ExtractEnvelopeSchema.safeParse(toolInput);
  if (!envelope.success) {
    return { ok: false, message: JSON.stringify(envelope.error.issues) };
  }
  const known = new Set(args.refs);
  const parsed: NewsClaim[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  let unsourced = 0;
  let form = 0;
  for (const item of envelope.data.claims) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped++;
      continue;
    }
    const { sources: rawSources, ...rest } = item as Record<string, unknown>;
    const sources = NewsSourcesSchema.safeParse(rawSources);
    const valid = sources.success ? [...new Set(sources.data)].filter((s) => known.has(s)) : [];
    if (valid.length === 0) {
      unsourced++;
      continue;
    }
    const claim = ClaimSchema.safeParse(normalizeClaimInput(rest));
    if (!claim.success) {
      dropped++;
      continue;
    }
    if (claim.data.topic === "form") {
      form++;
      continue;
    }
    if (parsed.length >= MAX_CLAIMS) {
      warnings.push(`Só as ${MAX_CLAIMS} primeiras afirmações das notícias foram consideradas.`);
      break;
    }
    parsed.push({ ...claim.data, sources: valid });
  }
  const allPlayers = parsed.flatMap((c) => c.players ?? []);
  const claims: NewsClaim[] = [];
  for (const c of parsed) {
    const text = stripPlayerNames(c.text, allPlayers, args.teams);
    const final = NewsClaimSchema.safeParse(text === c.text ? c : { ...c, text: fitText(text) });
    if (!final.success) {
      dropped++;
      continue;
    }
    claims.push(final.data);
  }
  if (dropped > 0) warnings.push(`${dropped} afirmação(ões) fora do formato ficaram de fora.`);
  if (unsourced > 0) {
    warnings.push(`${unsourced} afirmação(ões) sem notícia do lote como fonte ficaram de fora.`);
  }
  if (form > 0) warnings.push(`${form} afirmação(ões) de forma ficaram de fora (dado nosso).`);
  return { ok: true, claims, warnings };
}

// Texto no teto do ClaimSchema (com reticência quando corta).
function fitText(text: string): string {
  if (text.length <= CLAIM_TEXT_MAX) return text;
  return `${text.slice(0, CLAIM_TEXT_MAX - 1).trimEnd()}…`;
}

type ExtractArgs = {
  matchId: string;
  // Nomes canônicos (os da base).
  teams: TeamNames;
  kickoffAt: Date;
  items: readonly NewsExtractItem[];
  // Prazo da fase (duro): decide se a chamada ainda cabe (canFitCall) e se um timeout do
  // adapter foi falta de prazo.
  deadlineAt?: number;
  // Teto de UMA chamada, contado do início dela: o adapter corta em
  // min(deadlineAt, início + maxCallMs).
  maxCallMs?: number;
};

/**
 * Nunca lança: qualquer exceção (montar o request, achar o provider, o adapter) vira
 * ok:false com uma row provider_error em `ai_calls` quando der pra gravar.
 */
export async function extractNewsClaims(args: ExtractArgs): Promise<NewsExtractResult> {
  try {
    return await runExtraction(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        scope: "extractNewsClaims",
        matchId: args.matchId,
        error: "unexpected_throw",
        message,
      }),
    );
    let aiCallId: string | null = null;
    try {
      aiCallId = await persistAiCallError({
        userId: null,
        matchId: args.matchId,
        provider: EXTRACT_MODEL.provider,
        model: EXTRACT_MODEL,
        inputPayload: { items: args.items.length },
        outputPayload: { error: message },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "provider_error",
        errorMessage: message,
        promptVersion: MATCH_NEWS_EXTRACT_VERSION,
      });
    } catch {
      // Log best-effort.
    }
    return { ok: false, kind: "failed", message, aiCallId };
  }
}

async function runExtraction(args: ExtractArgs): Promise<NewsExtractResult> {
  const { matchId } = args;
  const model = EXTRACT_MODEL;
  const lines = prepareNewsLines(args.items);
  // Nada sobrou depois do saneamento: nada a extrair, sem chamada.
  if (lines.length === 0) return { ok: true, claims: [], warnings: [], aiCallId: null };
  const startedAt = Date.now();
  if (
    !canFitCall(
      args.deadlineAt,
      { speed: model.speed, maxTokens: EXTRACT_MAX_TOKENS, effort: UTILITY_EFFORT },
      startedAt,
    )
  ) {
    return { ok: false, kind: "deadline", message: "no time left", aiCallId: null };
  }
  const capAt = args.maxCallMs === undefined ? undefined : startedAt + args.maxCallMs;
  // Quem corta esta chamada é o prazo da fase (não o teto dela)?
  const boundByPhase =
    args.deadlineAt !== undefined && (capAt === undefined || args.deadlineAt <= capAt);
  const callDeadlineAt =
    args.deadlineAt === undefined || capAt === undefined
      ? (args.deadlineAt ?? capAt)
      : Math.min(args.deadlineAt, capAt);
  const refs = lines.map((l) => l.ref);
  const request: AnalysisRequest = {
    model,
    system: NEWS_EXTRACT_SYSTEM_PROMPT,
    userMessage: buildNewsExtractUserMessage({
      teams: args.teams,
      kickoffAt: args.kickoffAt,
      lines,
    }),
    tool: newsExtractTool,
    toolName: MATCH_NEWS_EXTRACT_TOOL_NAME,
    maxTokens: EXTRACT_MAX_TOKENS,
    effort: UTILITY_EFFORT,
    deadlineAt: callDeadlineAt,
  };
  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  if (!isAIProvider(providerKey)) {
    return { ok: false, kind: "failed", message: "provider inválido", aiCallId: null };
  }

  const fail = async (
    servedModel: AIModel,
    status: Exclude<AiCallStatus, "ok">,
    errorMessage: string,
    payload: {
      inputPayload: Record<string, unknown>;
      outputPayload: Record<string, unknown>;
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      latencyMs: number;
    },
  ): Promise<NewsExtractResult> => {
    const aiCallId = await persistAiCallError({
      userId: null,
      matchId,
      provider: providerKey,
      model: servedModel,
      ...payload,
      status,
      errorMessage,
      promptVersion: MATCH_NEWS_EXTRACT_VERSION,
    });
    return {
      ok: false,
      kind: status === "timeout" && boundByPhase ? "deadline" : "failed",
      message: errorMessage,
      aiCallId,
    };
  };

  if (!provider.hasKey()) {
    const msg = `${providerKey} provider has no API key configured`;
    return fail(model, "provider_error", msg, {
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: { error: msg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
  }

  const result = await provider.runAnalysis(request);
  const served = result.servedModel;
  const payload = {
    inputPayload: result.inputPayload,
    outputPayload: result.outputPayload,
    ...result.usage,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) return fail(served, result.status, result.message, payload);
  if (result.toolInput === undefined) {
    return fail(served, "tool_missing", `model did not call ${MATCH_NEWS_EXTRACT_TOOL_NAME}`, payload);
  }
  const read = claimsFromNewsToolInput(result.toolInput, { teams: args.teams, refs });
  if (!read.ok) return fail(served, "invalid_output", read.message, payload);

  const cost = calculateCost({
    model: served,
    inputTokens: payload.inputTokens,
    outputTokens: payload.outputTokens,
    cacheCreationInputTokens: payload.cacheCreationInputTokens,
    cacheReadInputTokens: payload.cacheReadInputTokens,
  });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: null,
        matchId,
        provider: providerKey,
        model: served.id,
        promptVersion: MATCH_NEWS_EXTRACT_VERSION,
        ...payload,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    aiCallId = row?.id ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "extractNewsClaims",
        matchId,
        error: "ai_call_insert_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return { ok: true, claims: read.claims, warnings: read.warnings, aiCallId };
}
