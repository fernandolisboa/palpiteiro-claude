import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  getFixtureById,
  getH2H,
  getInjuries,
  getLineups,
  getStandings,
  getTeamForm,
} from "@/lib/providers/api-football";
import {
  LEAGUE_IDS,
  currentSeason,
} from "@/lib/providers/api-football-constants";
import type {
  ApiFootballInjury,
} from "@/lib/providers/api-football-schemas";
import { getOddsForSport } from "@/lib/providers/odds-api";
import { SPORT_KEYS } from "@/lib/providers/odds-api-constants";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

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
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;
const ODDS_WINDOW_MS = 6 * 60 * 60 * 1000;
const ERROR_MESSAGE_MAX = 2000;

// Normalização básica pra matchear nomes de times entre API-Football e The Odds
// API: lowercase, remove acentos (NFD + strip combining marks) e descarta tokens
// comuns. Não é robusto pra todos os casos — grafias muito divergentes podem
// falhar (ver "Risco conhecido" no PR body).
const TEAM_NAME_STOPWORDS = new Set([
  "fc",
  "cf",
  "ac",
  "sc",
  "afc",
  "cfc",
  "ec",
  "se",
  "rb",
  "club",
  "clube",
]);

export function normalizeTeamName(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const tokens = folded
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TEAM_NAME_STOPWORDS.has(t));
  return tokens.join(" ");
}

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Odds matching ───────────────────────────────────────────────────────────

type OddsBundle = {
  bookmakerKey: string;
  bookmakerTitle: string;
  overOdd: number;
  underOdd: number;
  capturedAt: string;
};

function pickBestTotalsBookmaker(
  event: OddsApiEventOdds,
): OddsBundle | undefined {
  // Quando mais de um bookmaker oferece totals 2.5 pro mesmo evento, escolhemos
  // o de MENOR overround: probabilidade implícita mais "honesta" → edge é
  // calculado contra o mercado mais eficiente disponível e evita recomendar
  // contra odds artificialmente generosas de bookmakers exóticos (ver CLAUDE.md
  // "Edge calculation").
  let best: { bundle: OddsBundle; overround: number } | undefined;
  for (const bookmaker of event.bookmakers) {
    const totals = bookmaker.markets.find((m) => m.key === "totals");
    if (!totals) continue;
    let over: number | undefined;
    let under: number | undefined;
    for (const outcome of totals.outcomes) {
      if (outcome.point !== 2.5) continue;
      if (outcome.name.toLowerCase() === "over") over = outcome.price;
      if (outcome.name.toLowerCase() === "under") under = outcome.price;
    }
    if (over === undefined || under === undefined) continue;
    const overround = 1 / over + 1 / under - 1;
    if (!best || overround < best.overround) {
      best = {
        bundle: {
          bookmakerKey: bookmaker.key,
          bookmakerTitle: bookmaker.title,
          overOdd: over,
          underOdd: under,
          capturedAt: totals.last_update,
        },
        overround,
      };
    }
  }
  return best?.bundle;
}

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

function leagueToSportKey(
  league: "brasileirao_a" | "champions_league",
): (typeof SPORT_KEYS)[keyof typeof SPORT_KEYS] {
  return league === "brasileirao_a"
    ? SPORT_KEYS.BRASILEIRAO_A
    : SPORT_KEYS.CHAMPIONS_LEAGUE;
}

function leagueToApiFootballId(
  league: "brasileirao_a" | "champions_league",
): number {
  return league === "brasileirao_a"
    ? LEAGUE_IDS.BRASILEIRAO_A
    : LEAGUE_IDS.CHAMPIONS_LEAGUE;
}

function partitionInjuries(
  injuries: ApiFootballInjury[],
  homeTeamId: number,
  awayTeamId: number,
): { home: ApiFootballInjury[]; away: ApiFootballInjury[] } {
  const home: ApiFootballInjury[] = [];
  const away: ApiFootballInjury[] = [];
  for (const inj of injuries) {
    if (inj.team.id === homeTeamId) home.push(inj);
    else if (inj.team.id === awayTeamId) away.push(inj);
  }
  return { home, away };
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
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

  // 2. Parse externalId → API-Football fixture id
  const fixtureId = Number(match.externalId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    throw new PredictError("match.externalId is not a valid API-Football id", {
      matchId,
      externalId: match.externalId,
    });
  }

  // 3. Fetch fixture details (necessário pra team IDs e venue)
  const fixture = await getFixtureById(fixtureId);
  if (!fixture) {
    throw new PredictError("API-Football fixture not found", {
      fixtureId,
      matchId,
    });
  }
  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;
  const leagueId = leagueToApiFootballId(match.league);
  const season = currentSeason(leagueId, match.kickoffAt);

  // 4. Fetch demais dados em paralelo
  const [homeForm, awayForm, h2h, standings, allInjuries, lineups] =
    await Promise.all([
      getTeamForm(homeTeamId, FORM_LAST),
      getTeamForm(awayTeamId, FORM_LAST),
      getH2H(homeTeamId, awayTeamId),
      getStandings(leagueId, season),
      getInjuries({ fixtureId }),
      getLineups(fixtureId),
    ]);
  const injuries = partitionInjuries(allInjuries, homeTeamId, awayTeamId);

  // 5. Fetch odds e seleção de bookmaker
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
    fixture.teams.home.name,
    fixture.teams.away.name,
    match.kickoffAt,
  );
  if (!event) {
    throw new PredictError("no matching odds event found", {
      home: fixture.teams.home.name,
      away: fixture.teams.away.name,
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

  // 6. Implied probabilities normalizadas
  const implied = computeImpliedProbabilities(
    oddsBundle.overOdd,
    oddsBundle.underOdd,
  );
  const overPct = implied.overProb * 100;
  const underPct = implied.underProb * 100;

  // 7. Monta OverUnderInput
  let input: ReturnType<typeof buildPredictionInput>;
  try {
    input = buildPredictionInput({
      match: {
        externalId: match.externalId,
        league: match.league,
        homeTeam: { id: homeTeamId, name: fixture.teams.home.name },
        awayTeam: { id: awayTeamId, name: fixture.teams.away.name },
        kickoffAt: match.kickoffAt,
        venue: fixture.fixture.venue?.name ?? undefined,
      },
      standings,
      home: { form: homeForm, injuries: injuries.home },
      away: { form: awayForm, injuries: injuries.away },
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

  // 8. Monta payload do Claude
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

  // 9. Chamada do Claude (com cronômetro)
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

  // 10. Extração do tool_use block
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

  // 11. Validação Zod do output
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

  // 12. Persistência (sequencial — neon-http não suporta transações reais).
  // Em caso raro de falha na insert de predictions após ai_calls.ok já gravado,
  // o ai_call ficará órfão (auditável via LEFT JOIN). Tolerável no MVP.
  const cost = calculateCost({
    model: ANTHROPIC_MODEL,
    inputTokens,
    outputTokens,
  });
  const [aiCallRow] = await db
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

  const [predictionRow] = await db
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

  return predictionRow;
}
