import { z } from "zod";

import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, isAIProvider } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AiCallStatus, AnalysisRequest } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { roleFromPlayerWord, stripPlayerNames } from "@/lib/user-palpite/check-claims";
import type { TeamNames } from "@/lib/user-palpite/reading";
import { ClaimSchema, MAX_CLAIMS, type Claim } from "@/lib/user-palpite/types";

import {
  EXTRACT_SYSTEM_PROMPT,
  USER_PALPITE_EXTRACT_TOOL_NAME,
  USER_PALPITE_EXTRACT_VERSION,
  buildExtractUserMessage,
  extractTool,
} from "./extract-cartridge";

// Extração Haiku do motivo do "Seu palpite" (#564, ADR 0055) pelo seam AIProvider, com
// log em `ai_calls` — mesma disciplina de lib/ai/bet-parse/parse.ts: nunca SDK direto,
// nunca por predict.ts. Sem `canFitCall`: a action começa agora e a extração é a 1ª
// chamada (cabe sempre); o `deadlineAt` ainda vai pro adapter cortar o timeout.

const EXTRACT_MODEL = MODEL_REGISTRY["claude-haiku-4-5"];
const EXTRACT_MAX_TOKENS = 1500;

// Envelope frouxo: o item a item é o Zod de verdade (ClaimSchema); o teto de 8 é do
// código (o excedente é cortado com aviso).
export const ExtractEnvelopeSchema = z.object({ claims: z.array(z.unknown()) }).strict();

const OPTIONAL_FIELDS = ["players", "role", "direction", "scope"] as const;

/**
 * Limpa o item antes do Zod estrito: a Haiku às vezes manda `players: []`, `null` ou ""
 * nos campos que não se aplicam (vira ausente), e às vezes põe uma função
 * ("artilheiro") em players (sai de players e, sem role, vira o role).
 */
export function normalizeClaimInput(item: unknown): unknown {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
  const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const k of OPTIONAL_FIELDS) {
    const v = out[k];
    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k];
  }
  if (Array.isArray(out.players)) {
    const names: unknown[] = [];
    let inferred: ReturnType<typeof roleFromPlayerWord> = null;
    for (const p of out.players) {
      const role = typeof p === "string" ? roleFromPlayerWord(p) : null;
      if (role === null) names.push(p);
      else if (inferred === null || inferred === "unknown") inferred = role;
    }
    if (names.length > 0) out.players = names;
    else delete out.players;
    if (inferred !== null && out.role === undefined) out.role = inferred;
  }
  return out;
}

export type ExtractResult =
  | { ok: true; claims: Claim[]; warnings: string[]; aiCallId: string | null }
  | { ok: false; message: string; aiCallId: string | null };

type ExtractArgs = {
  reason: string;
  teams: TeamNames;
  matchId: string;
  userId: string;
  deadlineAt?: number;
  // De onde veio o texto, só pra o aviso de corte: o motivo do "Seu palpite" (#564) ou o
  // contexto extra da análise com IA (#565). O prompt é o mesmo.
  subject?: "motivo" | "contexto";
};

/**
 * Nunca lança: roda depois da cobrança, então qualquer exceção (montar o request,
 * achar o provider, o adapter) vira ok:false com uma row provider_error em `ai_calls`
 * quando der pra gravar.
 */
export async function extractPalpiteClaims(args: ExtractArgs): Promise<ExtractResult> {
  try {
    return await runExtraction(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        scope: "extractPalpiteClaims",
        matchId: args.matchId,
        error: "unexpected_throw",
        message,
      }),
    );
    let aiCallId: string | null = null;
    try {
      aiCallId = await persistAiCallError({
        userId: args.userId,
        matchId: args.matchId,
        provider: EXTRACT_MODEL.provider,
        model: EXTRACT_MODEL.id,
        inputPayload: { reasonChars: args.reason.length },
        outputPayload: { error: message },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "provider_error",
        errorMessage: message,
        promptVersion: USER_PALPITE_EXTRACT_VERSION,
      });
    } catch {
      // Log best-effort: o request segue sem a row.
    }
    return { ok: false, message, aiCallId };
  }
}

async function runExtraction(args: ExtractArgs): Promise<ExtractResult> {
  const { userId, matchId } = args;
  const model = EXTRACT_MODEL;
  const request: AnalysisRequest = {
    model,
    system: EXTRACT_SYSTEM_PROMPT,
    userMessage: buildExtractUserMessage(args.reason, args.teams),
    tool: extractTool,
    toolName: USER_PALPITE_EXTRACT_TOOL_NAME,
    maxTokens: EXTRACT_MAX_TOKENS,
    temperature: model.temperature,
    deadlineAt: args.deadlineAt,
  };
  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  if (!isAIProvider(providerKey)) {
    return { ok: false, message: "provider inválido", aiCallId: null };
  }

  const fail = async (
    status: Exclude<AiCallStatus, "ok">,
    errorMessage: string,
    payload: {
      inputPayload: Record<string, unknown>;
      outputPayload: Record<string, unknown>;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    },
  ): Promise<ExtractResult> => {
    const aiCallId = await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      ...payload,
      status,
      errorMessage,
      promptVersion: USER_PALPITE_EXTRACT_VERSION,
    });
    return { ok: false, message: errorMessage, aiCallId };
  };

  if (!provider.hasKey()) {
    const msg = `${providerKey} provider has no API key configured`;
    return fail("provider_error", msg, {
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: { error: msg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
  }

  const result = await provider.runAnalysis(request);
  const payload = {
    inputPayload: result.inputPayload,
    outputPayload: result.outputPayload,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) return fail(result.status, result.message, payload);
  if (result.toolInput === undefined) {
    return fail("tool_missing", `model did not call ${USER_PALPITE_EXTRACT_TOOL_NAME}`, payload);
  }
  const envelope = ExtractEnvelopeSchema.safeParse(result.toolInput);
  if (!envelope.success) {
    return fail("invalid_output", JSON.stringify(envelope.error.issues), payload);
  }

  const parsedClaims: Claim[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  for (const item of envelope.data.claims) {
    const parsed = ClaimSchema.safeParse(normalizeClaimInput(item));
    if (!parsed.success) {
      dropped++;
      continue;
    }
    if (parsedClaims.length >= MAX_CLAIMS) {
      warnings.push(
        `Considerei só as ${MAX_CLAIMS} primeiras afirmações do seu ${args.subject ?? "motivo"}.`,
      );
      break;
    }
    parsedClaims.push(parsed.data);
  }
  // Nome de jogador não fica na paráfrase (LGPD): ela vai ao narrador e à tela. Tira de
  // TODAS as paráfrases os nomes que o extrator identificou em qualquer afirmação.
  const allPlayers = parsedClaims.flatMap((c) => c.players ?? []);
  const claims: Claim[] = parsedClaims.map((c) => {
    const text = stripPlayerNames(c.text, allPlayers, args.teams);
    return text === c.text ? c : { ...c, text };
  });
  if (dropped > 0) {
    warnings.push(
      dropped === 1
        ? "Não entendi uma das suas afirmações; ela ficou de fora."
        : `Não entendi ${dropped} das suas afirmações; elas ficaram de fora.`,
    );
  }

  // Sucesso (inclusive zero afirmações: motivo só de opinião). Log best-effort.
  const cost = calculateCost({
    model: model.id,
    inputTokens: payload.inputTokens,
    outputTokens: payload.outputTokens,
  });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: USER_PALPITE_EXTRACT_VERSION,
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
        scope: "extractPalpiteClaims",
        matchId,
        error: "ai_call_insert_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return { ok: true, claims, warnings, aiCallId };
}
