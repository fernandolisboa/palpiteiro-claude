import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import { pickBestTotalsBookmaker } from "@/lib/odds/select-bookmaker";
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

import { ANTHROPIC_MODEL, getAnthropicClient } from "./anthropic";
import { BuildInputError, buildPredictionInput } from "./build-input";
import { calculateCost } from "./cost";
import {
  PROMPT_VERSION,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
} from "./prompts/over_under_v1";
import { OverUnderOutputSchema } from "./schemas/output";

// ─── Types & errors ──────────────────────────────────────────────────────────

export type PredictArgs = {
  matchId: string;
  userId: string;
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
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;
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
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: AiCallStatus;
  errorMessage: string;
}): Promise<void> {
  const cost = calculateCost({
    model: ANTHROPIC_MODEL,
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
      model: ANTHROPIC_MODEL,
      promptVersion: PROMPT_VERSION,
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
}: PredictArgs): Promise<Prediction> {
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

  // 4. Fetch odds e seleção de bookmaker
  const sportKey = leagueToSportKey(match.league);
  const kickoffMs = match.kickoffAt.getTime();
  const commenceTimeFrom = new Date(kickoffMs - ODDS_WINDOW_MS).toISOString();
  const commenceTimeTo = new Date(kickoffMs + ODDS_WINDOW_MS).toISOString();
  const events = await getOddsForSport(sportKey, {
    markets: ["totals"],
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
  const oddsBundle = pickBestTotalsBookmaker(event);
  if (!oddsBundle) {
    throw new PredictError("no over/under 2.5 odds available for event", {
      eventId: event.id,
      bookmakers: event.bookmakers.length,
    });
  }

  // 5. Implied probabilities normalizadas
  const implied = computeImpliedProbabilities(
    oddsBundle.overOdd,
    oddsBundle.underOdd,
  );
  const overPct = implied.overProb * 100;
  const underPct = implied.underProb * 100;

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
  const userMessage = buildUserMessage(input, { daysToKickoff });
  const inputPayload: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [SUBMIT_PREDICTION_TOOL],
    tool_choice: { type: "tool", name: SUBMIT_PREDICTION_TOOL.name },
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  };

  // 8. Chamada do Claude (com cronômetro)
  const client = getAnthropicClient();
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: SUBMIT_PREDICTION_TOOL.name },
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const classified = classifyAnthropicError(err);
    await persistAiCallError({
      userId,
      matchId,
      inputPayload,
      outputPayload: { error: serializeAnthropicError(err) },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: classified.status,
      errorMessage: classified.message,
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
      block.type === "tool_use" && block.name === SUBMIT_PREDICTION_TOOL.name,
  );
  if (!toolUse) {
    const snippet = JSON.stringify(response.content).slice(0, 500);
    await persistAiCallError({
      userId,
      matchId,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "tool_missing",
      errorMessage: `model did not call submit_prediction; content=${snippet}`,
    });
    throw new PredictError("LLM did not call submit_prediction tool", {
      stopReason: response.stop_reason,
    });
  }

  // 10. Validação Zod do output
  const parsed = OverUnderOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    await persistAiCallError({
      userId,
      matchId,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "invalid_output",
      errorMessage: JSON.stringify(parsed.error.issues),
    });
    throw new PredictError("LLM output failed Zod validation", {
      issues: parsed.error.issues,
    });
  }
  const output = parsed.data;

  // 11. Persistência (sequencial — neon-http não suporta transações reais).
  const cost = calculateCost({
    model: ANTHROPIC_MODEL,
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
        model: ANTHROPIC_MODEL,
        promptVersion: PROMPT_VERSION,
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

  let predictionRow: Prediction;
  try {
    const [row] = await db
      .insert(predictions)
      .values({
        matchId,
        userId,
        aiCallId: aiCallRow.id,
        market: "over_under_2_5",
        recommendation: output.recommendation,
        confidencePct: output.confidence_pct.toFixed(2),
        rationale: output.rationale,
        keyFactors: output.key_factors,
        minimumOdd: output.minimum_odd?.toFixed(3) ?? null,
        oddAtRecommendation: oddAtRec?.toFixed(3) ?? null,
        bookmaker: side !== "pass" ? oddsBundle.bookmakerTitle : null,
        impliedProbPct: impliedPct?.toFixed(2) ?? null,
        edgePct: edge?.toFixed(2) ?? null,
        modelVersion: ANTHROPIC_MODEL,
        promptVersion: PROMPT_VERSION,
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

  return predictionRow;
}
