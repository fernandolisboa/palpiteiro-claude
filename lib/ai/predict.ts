import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import {
  aiCalls,
  matches,
  predictionSelectionOdds,
  predictions,
} from "@/db/schema";
import { db } from "@/lib/db";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import { getLatestFreshOddsSnapshot } from "@/lib/db/queries/odds-snapshots";
import { extractDbCause } from "@/lib/db/pg-error";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { pickBestTotalsBookmaker, type OddsBundle } from "@/lib/odds/select-bookmaker";
import { getOddsForSport } from "@/lib/providers/odds-api";
import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
} from "@/lib/providers/sports-data/types";

import {
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";
import { getPreferredModelId } from "@/lib/db/queries/users";

import { getAnthropicClient } from "./anthropic";
import { calculateCost } from "./cost";
import { getCartridge } from "./markets/registry";
// O cartucho over/under expõe estes BINDINGS DE MÓDULO; predict.ts os importa
// nomeados (não via o objeto do cartucho) pra que os spies do teste (vi.spyOn)
// interceptem a montagem real do input e o catch de BuildInputError funcione.
import {
  BuildInputError,
  buildPredictionInput,
} from "./markets/over_under/build-input";
import type { OverUnderOutput } from "./markets/over_under/schemas";
import {
  MODEL_REGISTRY,
  isModelAllowedForAudience,
  type AIModelId,
} from "./models";
import { buildAnthropicRequest } from "./request-builder";

// ─── Types & errors ──────────────────────────────────────────────────────────

export type PredictArgs = {
  matchId: string;
  userId: string;
  // Audiência do caller (ADR 0013). Decide se a preferência pessoal do usuário
  // pode apontar pra um modelo admin-only: ex-admin rebaixado com Fable salvo
  // cai no default. NÃO afeta o `modelOverride` (já validado pelo caller).
  isAdmin: boolean;
  // Override admin-gated (já validado pelo caller); predict confia num
  // AIModelId. Ausente → usa a preferência do usuário / default global do DB.
  modelOverride?: AIModelId;
  // Mercado a analisar (ADR 0017). Default `"over_under"` (o caller único hoje
  // não passa). Resolve o cartucho via getCartridge — predict NÃO ramifica por
  // `if (market === X)`.
  marketKey?: string;
};

export type Prediction = typeof predictions.$inferSelect;

type AiCallStatus =
  | "ok"
  | "invalid_output"
  | "provider_error"
  | "timeout"
  | "tool_missing"
  | "rate_limited";

export class PredictError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "PredictError";
    this.context = context;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FORM_LAST = 5;
const H2H_LAST = 5;
const ODDS_WINDOW_MS = 6 * 60 * 60 * 1000;
const ERROR_MESSAGE_MAX = 2000;

// Re-export normalizeTeamName for back-compat with any caller still importing
// it from this module (e.g. tests). Canonical location is now
// lib/providers/sports-data/team-names.ts.
export { normalizeTeamName };

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Odds matching ───────────────────────────────────────────────────────────

function findMatchingEvent(
  events: OddsApiEventOdds[],
  homeName: string,
  awayName: string,
  kickoffAt: Date,
): OddsApiEventOdds | undefined {
  const kickoffMs = kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commence_time);
    if (!Number.isFinite(ts) || Math.abs(ts - kickoffMs) > ODDS_WINDOW_MS) {
      return false;
    }
    return (
      teamNamesMatch(event.home_team, homeName) &&
      teamNamesMatch(event.away_team, awayName)
    );
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function classifyAnthropicError(err: unknown): {
  status: Exclude<AiCallStatus, "ok" | "invalid_output" | "tool_missing">;
  message: string;
} {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: "timeout", message: err.message };
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = err.headers?.get?.("retry-after") ?? null;
    return {
      status: "rate_limited",
      message: `${err.status}: ${err.message}${retryAfter ? ` (retry-after=${retryAfter})` : ""}`,
    };
  }
  if (err instanceof Anthropic.APIError) {
    const requestId = err.headers?.get?.("request-id") ?? null;
    return {
      status: "provider_error",
      message: `${err.status ?? "?"}: ${err.message}${requestId ? ` (request-id=${requestId})` : ""}`,
    };
  }
  return {
    status: "provider_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

function serializeAnthropicError(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return {
      name: err.name,
      message: err.message,
      status: err.status ?? null,
      requestId: err.headers?.get?.("request-id") ?? null,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { error: String(err) };
}

async function persistAiCallError(args: {
  userId: string;
  matchId: string;
  model: AIModelId;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: AiCallStatus;
  errorMessage: string;
  promptVersion: string;
}): Promise<void> {
  const cost = calculateCost({
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
  });
  // This logs an error that ALREADY happened, so its own failure must not mask
  // the primary error by throwing a raw "Failed query: insert into ai_calls".
  // Swallow + log so the original PredictError surfaces to the caller.
  try {
    await db.insert(aiCalls).values({
      userId: args.userId,
      matchId: args.matchId,
      provider: "anthropic",
      model: args.model,
      promptVersion: args.promptVersion,
      inputPayload: args.inputPayload,
      outputPayload: args.outputPayload,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      latencyMs: args.latencyMs,
      costUsd: cost.toFixed(6),
      status: args.status,
      errorMessage: truncate(args.errorMessage, ERROR_MESSAGE_MAX),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "persistAiCallError",
        matchId: args.matchId,
        error: "ai_call_audit_insert_failed",
        originalStatus: args.status,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function predict({
  matchId,
  userId,
  isAdmin,
  modelOverride,
  marketKey = "over_under",
}: PredictArgs): Promise<Prediction> {
  // Cartucho de mercado (ADR 0017): resolve por marketKey (throw em desconhecido).
  // Read puro — roda ANTES de qualquer chamada paga; predict NÃO ramifica por
  // `if (market === X)`, todo o comportamento específico vem do cartucho.
  const cartridge = getCartridge(marketKey);

  // 0. Resolve o modelo UMA vez pela cascata completa (ADR 0013):
  //    override por análise > preferência do usuário > default global >
  //    DEFAULT_MODEL_ID. A preferência só vale se passar no filtro de audiência
  //    (admin-only nunca roda pra usuário comum — ex-admin rebaixado com Fable
  //    salvo cai no default). Havendo override, nem lemos a preferência (query
  //    desnecessária). As leituras de DB são baratas ante a chamada paga ao LLM.
  let resolvedModelId: AIModelId;
  if (modelOverride) {
    resolvedModelId = modelOverride;
  } else {
    const pref = await getPreferredModelId(userId);
    const usablePref =
      pref && isModelAllowedForAudience(pref, isAdmin) ? pref : null;
    resolvedModelId = usablePref ?? (await getDefaultModelId());
  }
  const model = MODEL_REGISTRY[resolvedModelId];

  // 1. Lookup do match no DB
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PredictError("match not found", { matchId });
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new PredictError("match is not analyzable", {
      matchId,
      status: match.status,
    });
  }
  const kickoffMs = match.kickoffAt.getTime();

  const provider = getSportsDataProvider();
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };

  // 2. Fetch normalized fixture (composite-keyed). Used to populate venue
  //    and serve as the reference for downstream lookups (lineups, injuries).
  const fixture = await provider.getFixtureByMatch(ref);
  if (!fixture) {
    throw new PredictError("fixture not found in provider", {
      matchId,
      ref,
      providerName: provider.capabilities.name,
    });
  }

  // 3. Parallel fetch of supporting data. The provider's adapters serialize
  //    HTTP calls through their concurrency + throttle limiters
  //    (lib/providers/http/), so the Promise.all here expresses logical
  //    independence; the transport layer enforces rate limits.
  //
  //    Injuries are wrapped in catch() to map both SportsDataUnsupportedError
  //    (capability missing, e.g. football-data.org has no injury endpoint) AND
  //    SportsDataTransientError (e.g. an api-football transient outage on the
  //    injuries route) to the same absences-unavailable signal for the AI input
  //    — the analysis proceeds and the LLM is told injuries are unavailable.
  //    This graceful degrade is scoped to ONLY the injuries fetch: every other
  //    fetch (form/h2h/standings/lineups) still rejects Promise.all on a
  //    transient error, and any non-transient/non-unsupported injuries error
  //    still bubbles up.
  const [homeForm, awayForm, h2h, standings, injuries, lineups] =
    await Promise.all([
      provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
      provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
      provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
      provider.getStandings(match.league),
      provider
        .getInjuriesByFixture(ref)
        .then((data) => ({ data, unavailable: false }))
        .catch((err: unknown) => {
          if (
            err instanceof SportsDataUnsupportedError ||
            err instanceof SportsDataTransientError
          ) {
            return {
              data: {
                home: [] as NormalizedInjury[],
                away: [] as NormalizedInjury[],
              },
              unavailable: true,
            };
          }
          throw err;
        }),
      provider.getLineups(ref),
    ]);
  const absencesAvailable = !injuries.unavailable;

  // 4. Odds: reusa uma snapshot fresca se a página já capturou uma nesta
  //    sessão (quota: evita uma 2ª call à Odds API). Cai no fetch direto
  //    quando predict() roda standalone (script, sem render prévio).
  let oddsBundle: OddsBundle;
  const freshSnapshot = await getLatestFreshOddsSnapshot(match.id);
  if (freshSnapshot) {
    oddsBundle = {
      bookmakerKey: "", // não usado downstream; schema guarda title, não key.
      bookmakerTitle: freshSnapshot.bookmaker,
      overOdd: Number(freshSnapshot.overOdd), // numeric → string no Drizzle.
      underOdd: Number(freshSnapshot.underOdd),
      capturedAt: freshSnapshot.capturedAt.toISOString(),
    };
  } else {
    const sportKey = leagueToSportKey(match.league);
    const commenceTimeFrom = new Date(kickoffMs - ODDS_WINDOW_MS).toISOString();
    const commenceTimeTo = new Date(kickoffMs + ODDS_WINDOW_MS).toISOString();
    const events = await getOddsForSport(sportKey, {
      // provider market key do descriptor (= "totals" pro over/under); request
      // byte-idêntico ao literal antigo, mas sem hardcode no predict.
      markets: [cartridge.descriptor.providerMarketKey],
      regions: ["eu"],
      commenceTimeFrom,
      commenceTimeTo,
    });
    const event = findMatchingEvent(
      events,
      fixture.homeTeam,
      fixture.awayTeam,
      match.kickoffAt,
    );
    if (!event) {
      throw new PredictError("no matching odds event found", {
        home: fixture.homeTeam,
        away: fixture.awayTeam,
        kickoff: match.kickoffAt.toISOString(),
        candidates: events.length,
      });
    }
    const bundle = pickBestTotalsBookmaker(event);
    if (!bundle) {
      throw new PredictError("no over/under 2.5 odds available for event", {
        eventId: event.id,
        bookmakers: event.bookmakers.length,
      });
    }
    oddsBundle = bundle;
  }

  // 4b. Catálogo do mercado (marketId + mapas seleção↔id) — read PRÉ-chamada-paga,
  //     keyed por dbMarketKey (= "over_under", NÃO o enum legado "over_under_2_5").
  //     Hard-fail aqui (market sem seed) acontece ANTES de queimar spend e ANTES
  //     do insert de ai_call. A persistência (passo 11) só CONSOME estes mapas.
  const catalog = await resolveMarketCatalog(cartridge.descriptor.dbMarketKey);

  // 4c. Guarda de seed COMPLETO — PRÉ-chamada-paga. resolveMarketCatalog (shared
  //     com #164) só hard-falha em mercado ausente ou ZERO seleções; um mercado
  //     seedado com SÓ ALGUMAS seleções (ex.: 'over' sem 'under') passaria por ela
  //     e só estouraria nos hard-fails por-seleção DEPOIS de client.messages.create()
  //     (queimando spend + uma row de ai_call). O invariante "falha antes do gasto"
  //     exige checar AQUI que TODA seleção do cartucho tem id no catálogo.
  const missingSelections = cartridge.selections.filter(
    (key) => !catalog.idByKey.has(key),
  );
  if (missingSelections.length > 0) {
    throw new PredictError(
      `market '${cartridge.descriptor.dbMarketKey}' seedado incompleto: faltam seleções [${missingSelections.join(", ")}]`,
      { marketKey, missingSelections },
    );
  }

  // 5. Implied probabilities normalizadas (N seleções; contrato chave→índice).
  //    O candidate-odds array é montado na ordem `descriptor.selectionKeys`
  //    (['over','under']) SOBRE as odds do bundle — nunca por ordem de linhas de
  //    read. impliedByKey indexa o resultado pela MESMA chave, e o *100 segue a
  //    ordem de operações de antes (probs[i] * 100) → bit-exato com o legado.
  const selectionKeys = cartridge.descriptor.selectionKeys; // ['over','under']
  const candidateOddsByKey: Record<string, number> = {
    over: oddsBundle.overOdd,
    under: oddsBundle.underOdd,
  };
  const candidateOdds = selectionKeys.map((key) => candidateOddsByKey[key]);
  const { probs } = computeMarketImpliedProbabilities(candidateOdds);
  const impliedByKey: Record<string, number> = {};
  selectionKeys.forEach((key, i) => {
    impliedByKey[key] = probs[i] * 100;
  });
  const overPct = impliedByKey.over;
  const underPct = impliedByKey.under;

  // 6. Monta OverUnderInput
  let input: ReturnType<typeof buildPredictionInput>;
  try {
    input = buildPredictionInput({
      match: {
        externalId: match.externalId,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt,
        venue: fixture.venue,
      },
      standings,
      home: {
        form: homeForm,
        injuries: injuries.data.home,
        absencesAvailable,
      },
      away: {
        form: awayForm,
        injuries: injuries.data.away,
        absencesAvailable,
      },
      lineups,
      h2h,
      odds: {
        bookmaker: oddsBundle.bookmakerTitle,
        over_2_5_decimal: oddsBundle.overOdd,
        under_2_5_decimal: oddsBundle.underOdd,
        captured_at: new Date(oddsBundle.capturedAt).toISOString(),
      },
      implied: { over_pct: overPct, under_pct: underPct },
    });
  } catch (err) {
    if (err instanceof BuildInputError) {
      throw new PredictError(`buildPredictionInput failed: ${err.message}`, {
        ...err.context,
      });
    }
    throw err;
  }

  // 7. Monta payload do Claude
  const daysToKickoff = Math.max(
    0,
    Math.ceil((kickoffMs - Date.now()) / 86_400_000),
  );
  const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });
  // Parâmetros de geração calibráveis (ADR 0008, emenda 2). Aplicados MODEL-AWARE
  // pelo request-builder: maxTokens p/ todos, effort só adaptive, temperature só
  // temperature-mode. Leitura barata de DB ante a chamada paga ao LLM.
  const genParams = await getGenerationParams();
  // Constrói UM objeto de request model-aware, reusado tanto pro inputPayload
  // logado quanto pra chamada real (sem divergência). request-builder omite
  // temperature em modelos adaptive (Opus 4.8 dá 400) e a mantém no Sonnet 4.5.
  const request = buildAnthropicRequest({
    model,
    system: cartridge.systemPrompt,
    userMessage,
    tools: [cartridge.tool],
    toolName: cartridge.toolName,
    maxTokens: genParams.maxTokens,
    effort: genParams.effort,
    temperature: genParams.temperature,
  });
  const inputPayload = request as unknown as Record<string, unknown>;

  // 8. Chamada do Claude (com cronômetro)
  const client = getAnthropicClient();
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(request);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const classified = classifyAnthropicError(err);
    await persistAiCallError({
      userId,
      matchId,
      model: model.id,
      inputPayload,
      outputPayload: { error: serializeAnthropicError(err) },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: classified.status,
      errorMessage: classified.message,
      promptVersion: cartridge.version,
    });
    throw new PredictError(`anthropic call failed: ${classified.message}`, {
      cause: err,
    });
  }
  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const outputPayload = response as unknown as Record<string, unknown>;

  // 9. Extração do tool_use block
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === cartridge.toolName,
  );
  if (!toolUse) {
    const snippet = JSON.stringify(response.content).slice(0, 500);
    await persistAiCallError({
      userId,
      matchId,
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
    throw new PredictError("LLM did not call submit_prediction tool", {
      stopReason: response.stop_reason,
    });
  }

  // 10. Validação Zod do output (schema do cartucho; fronteira do CLAUDE.md —
  //     output do LLM SEMPRE validado por Zod antes de uso).
  const parsed = cartridge.outputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    await persistAiCallError({
      userId,
      matchId,
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
    throw new PredictError("LLM output failed Zod validation", {
      issues: parsed.error.issues,
    });
  }
  // O registry apaga o genérico do schema (ZodType<unknown>); pro #165 o único
  // cartucho é over/under e a costura de persistência (colunas legadas + PSO)
  // é over/under-específica — narrow pro tipo concreto do output.
  const output = parsed.data as OverUnderOutput;

  // 11. Persistência (sequencial — neon-http não suporta transações reais).
  const cost = calculateCost({
    model: model.id,
    inputTokens,
    outputTokens,
  });
  let aiCallRow: typeof aiCalls.$inferSelect;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: "anthropic",
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
      .returning();
    aiCallRow = row;
  } catch (err) {
    // O erro real do Postgres mora em err.cause; Drizzle só expõe o wrapper
    // "Failed query:" em err.message. Sem isto, uma violação de FK/constraint
    // some no log como "unexpected". Ver lib/db/pg-error.ts.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        error: "ai_call_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist ai_call", cause);
  }

  const side = output.recommendation;
  const oddAtRec =
    side === "over"
      ? oddsBundle.overOdd
      : side === "under"
        ? oddsBundle.underOdd
        : null;
  const impliedPct =
    side === "over" ? overPct : side === "under" ? underPct : null;
  const edge =
    side !== "pass" && impliedPct !== null
      ? output.confidence_pct - impliedPct
      : null;

  // Coluna NOVA `selection_id`: o lado escolhido (NULL em pass — não há seleção).
  // Resolvido em MEMÓRIA pelo catálogo já lido — hard-fail ANTES do insert (não
  // violação de FK opaca pós-paga) se a seleção recomendada não estiver seedada.
  let selectionId: string | null = null;
  if (side !== "pass") {
    const id = catalog.idByKey.get(side);
    if (!id) {
      throw new PredictError(
        `seleção '${side}' não seedada pro market '${cartridge.descriptor.dbMarketKey}'`,
        { marketKey, recommendation: side },
      );
    }
    selectionId = id;
  }

  // Rows do candidate set (over+under) pra prediction_selection_odds, montadas
  // ANTES do insert da prediction pra que um seed faltante falhe SEM ter
  // commitado a prediction (mesma semântica do hard-fail de selectionId acima).
  // odds = EXATAMENTE o par legado do MESMO bundle → PSO["over"] ===
  // overOddAtPrediction byte-a-byte. Uma row por seleção, INCLUSIVE em pass.
  const oddByKey: Record<string, number> = {
    over: oddsBundle.overOdd,
    under: oddsBundle.underOdd,
  };
  const psoRowsToInsert = selectionKeys.map((key) => {
    const sid = catalog.idByKey.get(key);
    if (!sid) {
      throw new PredictError(
        `seleção '${key}' não seedada pro market '${cartridge.descriptor.dbMarketKey}'`,
        { marketKey, key },
      );
    }
    return { selectionId: sid, odd: oddByKey[key].toFixed(3) };
  });

  let predictionRow: Prediction;
  try {
    const [row] = await db
      .insert(predictions)
      .values({
        matchId,
        userId,
        aiCallId: aiCallRow.id,
        market: "over_under_2_5",
        // Colunas NOVAS multi-mercado (#165): marketId do catálogo; selectionId
        // resolvido acima (NULL em pass); marketParams verbatim do descriptor
        // (= { line: 2.5 } NUMBER).
        marketId: catalog.marketId,
        selectionId,
        marketParams: cartridge.descriptor.params ?? null,
        recommendation: output.recommendation,
        confidencePct: output.confidence_pct.toFixed(2),
        rationale: output.rationale,
        keyFactors: output.key_factors,
        minimumOdd: output.minimum_odd?.toFixed(3) ?? null,
        oddAtRecommendation: oddAtRec?.toFixed(3) ?? null,
        // bookmaker = fonte das odds analisadas — persiste também em pass
        // (ADR 0012, decisão 3).
        bookmaker: oddsBundle.bookmakerTitle,
        impliedProbPct: impliedPct?.toFixed(2) ?? null,
        edgePct: edge?.toFixed(2) ?? null,
        // Par congelado dos DOIS lados, pra toda recomendação inclusive pass
        // (ADR 0012, decisões 3-4) — alimenta o bloco de cenários sem depender
        // de snapshot vivo.
        overOddAtPrediction: oddsBundle.overOdd.toFixed(3),
        underOddAtPrediction: oddsBundle.underOdd.toFixed(3),
        modelVersion: model.id,
        promptVersion: cartridge.version,
      })
      .returning();
    predictionRow = row;
  } catch (err) {
    // ai_call já foi persistido (custo registrado); só a prediction falhou.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        aiCallId: aiCallRow.id,
        error: "prediction_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist prediction", cause);
  }

  // 12. prediction_selection_odds (SEQUENCIAL, após prediction.id — o FK NOT NULL
  //     só existe após .returning()). As rows (candidate set, INCLUSIVE pass) já
  //     foram montadas acima; aqui só ligamos o predictionId e inserimos.
  //
  //     Falha AQUI (prediction já commitada) = log + DEGRADE (não throw): retorna
  //     a prediction; o candidate set é re-preenchível pelo backfill #162
  //     (idempotente via o UNIQUE). Janela de parcialidade tolerada (estilo
  //     persistAiCallError — não mascarar a prediction válida com um erro de PSO).
  try {
    await db.insert(predictionSelectionOdds).values(
      psoRowsToInsert.map((r) => ({
        predictionId: predictionRow.id,
        selectionId: r.selectionId,
        odd: r.odd,
      })),
    );
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        predictionId: predictionRow.id,
        error: "prediction_selection_odds_insert_failed",
        ...cause,
      }),
    );
    // Degrade: a prediction já está persistida; não derrubar o caller por uma
    // falha do candidate set (re-preenchível pelo backfill #162).
  }

  return predictionRow;
}
