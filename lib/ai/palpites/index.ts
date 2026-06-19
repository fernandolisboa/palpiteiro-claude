import { eq } from "drizzle-orm";

import { aiCalls, matches, palpiteSets, palpites } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import type { DbPalpite, DbPalpiteSet } from "@/lib/db/queries/palpites";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import { getGenerationParams } from "@/lib/db/queries/ai-config";

import { persistAiCallError, truncate } from "../ai-call-logging";
import { calculateCost } from "../cost";
import { MODEL_REGISTRY, isAIProvider, type AIModelId } from "../models";
import { getProviderForModel } from "../providers";
import type { AnalysisRequest } from "../providers/types";
import {
  ExactScoreParamsSchema,
  type PalpitesOutput,
} from "./cartridges/cartridge";
import { getPalpiteCartridge } from "./registry";
import { deriveSettleable } from "./settleable";
import {
  PalpiteError,
  type GeneratePalpiteArgs,
  type PalpiteGenerationResult,
} from "./types";

export { PalpiteError } from "./types";
export type {
  GeneratePalpiteArgs,
  PalpiteGenerationResult,
} from "./types";

const FORM_LAST = 5;
const H2H_LAST = 5;
const TEXT_MAX = 280;

/**
 * Gera um conjunto de palpites de engajamento (ADR 0028) para um jogo. IRMÃO de
 * `predict()` (NÃO o chama): reusa SÓ (a) o seam de provider (ADR 0027, p/ logar
 * ai_calls) e (b) o padrão de logging. Market-free — ZERO edge/odds/stake/Yield,
 * ZERO import de SDK de IA, de ./markets/*, ./staking ou lib/odds/*.
 *
 * Default Haiku (econômico, temperature-mode). O input é ENXUTO (form/h2h/standings
 * + nomes) — placar exato não precisa de lineups/absences detalhados (PLAN §1.4 §4).
 */
export async function generatePalpites({
  matchId,
  userId,
  previousSets,
  modelOverride,
}: GeneratePalpiteArgs): Promise<PalpiteGenerationResult> {
  // 1. Modelo: SEM cascata de preferência (palpite é universal). Fixo no registry.
  const resolvedModelId: AIModelId = modelOverride ?? "claude-haiku-4-5";
  const model = MODEL_REGISTRY[resolvedModelId];

  // 2. Lookup do match. Gate de analisabilidade idêntico ao predict (finished/
  //    cancelled → throw): não geramos palpite de jogo encerrado.
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PalpiteError("match not found", { matchId });
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new PalpiteError("match is not analyzable", {
      matchId,
      status: match.status,
    });
  }
  const kickoffMs = match.kickoffAt.getTime();

  // 3. Cartucho (sem extraLines/marketKey).
  const cartridge = getPalpiteCartridge();

  // 4. Fetch de dados de suporte — ENXUTO (PLAN §1.4 §4): form/h2h/standings via a
  //    SportsDataProvider. SEM absences/lineups (palpite barato não justifica os
  //    créditos). `fixture` (venue + nomes normalizados) ainda é útil e barato.
  const provider = getSportsDataProvider();
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const [fixture, homeForm, awayForm, h2h, standings] = await Promise.all([
    provider.getFixtureByMatch(ref),
    provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
    provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
    provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
    provider.getStandings(match.league),
  ]);

  // 5. Monta input (com exclusão) + 6. userMessage.
  const input = cartridge.buildPredictionInput({
    match: {
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
    },
    fixture,
    homeForm,
    awayForm,
    h2h,
    standings,
    previousSets,
  });
  const daysToKickoff = Math.max(
    0,
    Math.ceil((kickoffMs - Date.now()) / 86_400_000),
  );
  const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });

  // 7. AnalysisRequest. temperature EXPLÍCITO de model.temperature (0.3 p/ Haiku) —
  //    NÃO genParams.temperature (null em temperature-mode). SEM effort (Haiku é
  //    temperature-mode; effort seria ignorado). maxTokens de getGenerationParams.
  const genParams = await getGenerationParams();
  const analysisRequest: AnalysisRequest = {
    model,
    system: cartridge.systemPrompt,
    userMessage,
    tool: cartridge.tool,
    toolName: cartridge.toolName,
    maxTokens: genParams.maxTokens,
    temperature: model.temperature,
  };

  // 8. Provider via o seam (ADR 0027). Sem chave → provider_error auditado + throw,
  //    zero gasto.
  const aiProvider = getProviderForModel(model);
  const providerKey = aiProvider.providerKey;
  if (!isAIProvider(providerKey)) {
    throw new PalpiteError(
      `unknown AI provider '${providerKey}' for model ${model.id}`,
      { provider: providerKey, model: model.id },
    );
  }
  if (!aiProvider.hasKey()) {
    const noKeyMsg = `${providerKey} provider has no API key configured`;
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: analysisRequest as unknown as Record<string, unknown>,
      outputPayload: { error: noKeyMsg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: noKeyMsg,
      promptVersion: cartridge.version,
    });
    throw new PalpiteError(noKeyMsg, { provider: providerKey, model: model.id });
  }
  const result = await aiProvider.runAnalysis(analysisRequest);
  const latencyMs = result.latencyMs;

  // 9. Erro do provider.
  if (!result.ok) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs,
      status: result.status,
      errorMessage: result.message,
      promptVersion: cartridge.version,
    });
    throw new PalpiteError(`palpite generation failed: ${result.message}`, {
      cause: result.cause,
    });
  }
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const inputPayload = result.inputPayload;
  const outputPayload = result.outputPayload;

  // 10. tool_missing.
  if (result.toolInput === undefined) {
    const snippet = JSON.stringify(
      (result.outputPayload as { content?: unknown }).content,
    ).slice(0, 500);
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "tool_missing",
      errorMessage: `model did not call ${cartridge.toolName}; content=${snippet}`,
      promptVersion: cartridge.version,
    });
    throw new PalpiteError("LLM did not call submit_palpites tool", {
      stopReason: result.stopReason,
    });
  }

  // 11. Validação Zod (fronteira do CLAUDE.md).
  const parsed = cartridge.outputSchema.safeParse(result.toolInput);
  if (!parsed.success) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "invalid_output",
      errorMessage: JSON.stringify(parsed.error.issues),
      promptVersion: cartridge.version,
    });
    throw new PalpiteError("LLM output failed Zod validation", {
      issues: parsed.error.issues,
    });
  }
  // Já tipado pelo schema concreto do cartucho (diferente de predict, que apaga
  // para BaseMarketOutput).
  const output: PalpitesOutput = parsed.data;

  // 12. Persistência (sequencial — neon-http não suporta transação real).
  // 12a. ai_call (status ok) — id alimenta palpite_sets.aiCallId.
  const cost = calculateCost({ model: model.id, inputTokens, outputTokens });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: cartridge.version,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    aiCallId = row.id;
  } catch (err) {
    // ASSIMETRIA INTENCIONAL: aiCallId=null no insert do ai_call que falha é
    // DELIBERADO (ADR 0028 §1, FK nullable em palpite_sets). O set é o produto e
    // SOBREVIVE à falha do log de auditoria. Não throw aqui. (Contraste: a falha
    // do insert de palpite_set SIM faz throw — sem child rows órfãs.)
    console.error(
      JSON.stringify({
        scope: "generatePalpites",
        matchId,
        error: "ai_call_insert_failed",
        ...extractDbCause(err),
      }),
    );
  }

  // 12b. palpite_set — parent. RETURNING id p/ as linhas filhas. Falha aqui PROPAGA
  //      (throw): sem set, não há filhos a inserir — nada de órfãos.
  let setRow: DbPalpiteSet;
  try {
    const [row] = await db
      .insert(palpiteSets)
      .values({
        matchId,
        userId,
        aiCallId, // pode ser null
        modelVersion: model.id,
        promptVersion: cartridge.version,
      })
      .returning();
    setRow = row;
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "generatePalpites",
        matchId,
        userId,
        error: "palpite_set_insert_failed",
        ...cause,
      }),
    );
    throw new PalpiteError("failed to persist palpite_set", cause);
  }

  // 12c. palpites — child rows, sequencial. settleable DERIVADO (não do LLM); params
  //      re-validado por Zod no boundary; text truncado (prose-tolerante).
  const palpiteRows: DbPalpite[] = [];
  for (const line of output.palpites) {
    const settleable = deriveSettleable(line.type);
    const params =
      line.type === "exact_score"
        ? ExactScoreParamsSchema.parse(line.params)
        : null;
    const [pRow] = await db
      .insert(palpites)
      .values({
        palpiteSetId: setRow.id,
        type: line.type,
        text: truncate(line.text, TEXT_MAX),
        params,
        settleable,
      })
      .returning();
    palpiteRows.push(pRow);
  }

  return {
    palpiteSet: setRow,
    palpites: palpiteRows,
    aiCall: aiCallId ? { id: aiCallId } : null,
  };
}
