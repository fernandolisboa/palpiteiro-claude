import { eq } from "drizzle-orm";

import { aiCalls, matches, palpiteSets, palpites } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import type { DbPalpiteSet } from "@/lib/db/queries/palpites";
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
  type PalpiteSynthesisOutput,
} from "./cartridges/cartridge";
import { getPalpiteCartridge } from "./registry";
import { deriveSettleable } from "./settleable";
import { containsValueLanguage } from "./value-language-guard";
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
 * Passo de SÍNTESE do palpite-first (ADR 0030 / #353): turna as N análises
 * multi-mercado já pagas pelo fan-out (`analyses`) numa única MANCHETE — veredito de
 * quem ganha + placar provável + confiança qualitativa + narrativa + mercados citados.
 * IRMÃO de `predict()` (NÃO o chama): reusa SÓ (a) o seam de provider (ADR 0027, p/
 * logar ai_calls) e (b) o padrão de logging. ZERO import de SDK de IA.
 *
 * FIREWALL (ADR 0030 §3): a síntese é ALIMENTADA com edge/EV/odd via `analyses`
 * (DADO) — mas a manchete (output) carrega ZERO número de valor. Três pernas: (a)
 * output Zod `.strict()` sem campo de valor; (b) `containsValueLanguage` pós-Zod;
 * (c) o `PalpiteHeadlineView` sem campo de valor (na camada de view).
 *
 * Default Haiku (econômico, temperature-mode). Fetch de suporte ENXUTO (form/h2h/
 * standings) como cor narrativa — crucial no caso all-pass (veredito apoia na forma).
 */
export async function generatePalpites({
  matchId,
  userId,
  analyses,
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

  // 4. Fetch de dados de suporte — ENXUTO: form/h2h/standings via a SportsDataProvider
  //    (mantido como COR NARRATIVA, crucial no caso all-pass; cache do fan-out já
  //    aqueceu → latência marginal). SEM absences/lineups. `fixture` (venue + nomes)
  //    ainda é útil e barato.
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

  // 5. Monta input (com as análises) + 6. userMessage.
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
    analyses,
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
    throw new PalpiteError(`LLM did not call ${cartridge.toolName} tool`, {
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
  const output: PalpiteSynthesisOutput = parsed.data;

  // 11b. FIREWALL leg (b) — guard de CONTEÚDO pós-Zod (ADR 0030 §3, blocker #5). O
  //      `.strict()` só barra chaves; o LLM pode ecoar um TERMO de valor numa string.
  //      Rodamos sobre TODO campo que cruza pra manchete/view: verdict + narrative +
  //      o `text` derivado da linha settleable + os rótulos de citedMarkets (LLM-livre,
  //      vão verbatim pro PalpiteHeadlineView). Hit → tratado como `invalid_output`
  //      (mesmo path auditado do Zod) → throw → degrada pra palpite:null no try/catch
  //      do analyzeBestBet. REJEITAR > VAZAR.
  const settleableText = `${output.verdict} — provável ${output.probableScore.home}×${output.probableScore.away}`;
  const valueLeak =
    containsValueLanguage(output.verdict) ||
    containsValueLanguage(output.narrative) ||
    containsValueLanguage(settleableText) ||
    output.citedMarkets.some(containsValueLanguage);
  if (valueLeak) {
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
      errorMessage: "manchete contém linguagem de valor (firewall ADR 0030 §3)",
      promptVersion: cartridge.version,
    });
    throw new PalpiteError("palpite headline leaked value language", {
      matchId,
    });
  }

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

  // 12b. palpite_set — parent. RETURNING id p/ a linha filha. Falha aqui PROPAGA
  //      (throw): sem set, não há filho a inserir — nada de órfãos. `headline` jsonb
  //      carrega a manchete (sem placar — esse vira a linha settleable); proveniência
  //      = os predictionIds das análises que alimentaram a síntese (ADR 0030 §4).
  const sourcePredictionIds = analyses.map((a) => a.predictionId);
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
        headline: {
          verdict: output.verdict,
          confidence: output.confidence,
          narrative: output.narrative,
          citedMarkets: output.citedMarkets,
          sourcePredictionIds,
        },
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

  // 12c. palpites — UMA linha settleable `exact_score` derivada do `probableScore`
  //      (ADR 0030: o placar provável é o único ponto conferido = o badge). settleable
  //      DERIVADO da constante de tipo (NUNCA do LLM); params re-validado por Zod no
  //      boundary; text = label derivado do veredito + placar (já passou pelo guard de
  //      value-language acima, junto com verdict/narrative). NÃO gera mais red_card/
  //      corners (os valores do enum permanecem; ADR 0030 — gate Tier 3 de pé).
  const params = ExactScoreParamsSchema.parse(output.probableScore);
  const settleable = deriveSettleable("exact_score");
  const [pRow] = await db
    .insert(palpites)
    .values({
      palpiteSetId: setRow.id,
      type: "exact_score",
      text: truncate(settleableText, TEXT_MAX),
      params,
      settleable,
    })
    .returning();

  return {
    palpiteSet: setRow,
    palpites: [pRow],
    aiCall: aiCallId ? { id: aiCallId } : null,
  };
}
