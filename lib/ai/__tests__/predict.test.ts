import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedLineup,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

// ─── Module mocks (every external boundary predict() touches) ────────────────
//
// No real DB / Anthropic / HTTP is hit. predict.ts is the sole LLM entrypoint,
// so we stub getAnthropicClient (no ANTHROPIC_API_KEY needed) and the two
// provider boundaries (sports-data + odds-api). The db mock returns a single
// analyzable match for the lookup and stub rows for the two inserts.

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "brasileirao_a" as SupportedLeague,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
  status: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

// Chainable db stub: select().from().where().limit() resolves [matchRow];
// insert().values().returning() resolves a stub row (ai_call then prediction).
//
// `insertValues` is a hoisted spy shared across every insert().values() call, so
// tests can read the exact row written to each table. predict() inserts ai_calls
// FIRST, then predictions, then prediction_selection_odds (SEQUENTIAL — #165),
// so insertValues.mock.calls[0] is the ai_call row, [1] the prediction row, and
// [2] the PSO rows array. The returning() stub gives the first two an `id` (the
// ai_call needs `aiCallId` downstream; the prediction row is the resolved value);
// the PSO insert awaits .values() directly (no .returning()).
const insertValues = vi.fn();
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: (...args: unknown[]) => {
      insertValues(...args);
      return {
        returning: vi.fn(() =>
          Promise.resolve([{ id: "row-1", aiCallId: "row-1" }]),
        ),
      };
    },
  }));
  return { db: { select, insert } };
});

const getInjuriesByFixture = vi.fn();
const getTeamForm = vi.fn();
const getH2H = vi.fn();
const getStandings = vi.fn();
const getLineups = vi.fn();
const getFixtureByMatch = vi.fn();

vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: vi.fn((): SportsDataProvider => {
    const capabilities: ProviderCapabilities = {
      name: "mock",
      supportsInjuries: true,
      supportsLineups: true,
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    };
    return {
      capabilities,
      getFixturesByDate: vi.fn() as never,
      getFixturesBySeason: vi.fn() as never,
      getFixtureByMatch: getFixtureByMatch as never,
      getFixtureResult: vi.fn() as never,
      getFixtureEvents: vi.fn() as never,
      getH2H: getH2H as never,
      getStandings: getStandings as never,
      getInjuriesByFixture: getInjuriesByFixture as never,
      getInjuriesByTeam: vi.fn() as never,
      getLineups: getLineups as never,
      getTeamForm: getTeamForm as never,
    };
  }),
}));

const getOddsForSport = vi.fn();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...args),
}));

// predict() agora lê a captura genérica N-vias (selection_odds_snapshots) via
// getLatestFreshSelectionOddsSnapshots — não mais o par binário legado. O mock
// devolve um LatestSelectionSnapshot {bookmaker, capturedAt, overroundPct,
// selections:[{key,odd:string}]} (numeric = string, como o Drizzle entrega).
const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...args: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...args),
}));

// Catalog resolver consolidado (#165): predict() o chama no bloco de reads
// PRÉ-chamada-paga (marketId + selection id↔key). Stub fixo do mercado
// over/under — sem ele, a query de marketSelections (sem .limit()) cairia no
// branch não-awaitable do select stub e estouraria com TypeError.
const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketCatalog: (...args: unknown[]) => resolveMarketCatalog(...args),
}));

const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

const getDefaultModelId = vi.fn();
const getGenerationParams = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: (...args: unknown[]) => getDefaultModelId(...args),
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
}));

const getPreferredModelId = vi.fn();
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: (...args: unknown[]) => getPreferredModelId(...args),
}));

// predict.ts agora despacha via `cartridge.buildPredictionInput` (#173): resolve
// `getCartridge("over_under")` = a MESMA instância `overUnderCartridge`. Espionar a
// PROPRIEDADE do cartucho (vi.spyOn(overUnderCartridge, "buildPredictionInput"))
// intercepta a montagem real — se algum seam ainda chamasse o binding de módulo
// antigo, o spy NÃO seria atingido e o `toHaveBeenCalledTimes(1)` falharia alto.
// O binding nomeado `buildPredictionInput` segue importado só pro real-call do
// snapshot :958 (eval-noop), que NÃO passa por predict.
import { buildPredictionInput } from "@/lib/ai/markets/over_under/build-input";
import { overUnderCartridge } from "@/lib/ai/markets/over_under";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

import { predict, PredictError } from "@/lib/ai/predict";

// ─── Fixtures for the happy-path mocks ───────────────────────────────────────

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: matchRow.kickoffAt.toISOString(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
};

const FIXTURE: NormalizedFixture = {
  id: `brasileirao_a:${REF.kickoffAt}:${REF.homeTeam}:${REF.awayTeam}`,
  league: "brasileirao_a",
  kickoffAt: REF.kickoffAt,
  kickoffTimestampMs: matchRow.kickoffAt.getTime(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  status: "scheduled",
  score: { home: null, away: null },
  venue: "Maracanã",
};

// Standings MUST contain rows for both teams or buildPredictionInput throws
// BuildInputError before any LLM call.
const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: matchRow.homeTeam,
          played: 10,
          won: 6,
          draw: 2,
          lost: 2,
          goalsFor: 18,
          goalsAgainst: 9,
          points: 20,
        },
        {
          position: 2,
          team: matchRow.awayTeam,
          played: 10,
          won: 5,
          draw: 3,
          lost: 2,
          goalsFor: 15,
          goalsAgainst: 10,
          points: 18,
        },
      ],
    },
  ],
};

const LINEUPS: NormalizedLineup | undefined = undefined;

// One odds event matching the team names within ODDS_WINDOW_MS of kickoff,
// carrying a totals market with over/under 2.5 so pickBestTotalsBookmaker
// returns a bundle.
const ODDS_EVENT: OddsApiEventOdds = {
  id: "evt-1",
  sport_key: "soccer_brazil_campeonato",
  commence_time: REF.kickoffAt,
  home_team: matchRow.homeTeam,
  away_team: matchRow.awayTeam,
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      last_update: "2026-05-15T12:00:00Z",
      markets: [
        {
          key: "totals",
          last_update: "2026-05-15T12:00:00Z",
          outcomes: [
            { name: "Over", price: 1.9, point: 2.5 },
            { name: "Under", price: 1.95, point: 2.5 },
          ],
        },
      ],
    },
  ],
};

// A fresh N-way capture, mirroring LatestSelectionSnapshot. The `odd` fields come
// back from Drizzle as JS STRINGS — predict() must Number() them at the boundary
// before any edge math.
const FRESH_SNAPSHOT = {
  bookmaker: "Pinnacle",
  capturedAt: new Date(),
  overroundPct: "3.50",
  selections: [
    { key: "over", odd: "1.900" },
    { key: "under", odd: "1.950" },
  ],
};

// Anthropic.Message-shaped response with a tool_use block whose input
// satisfies OverUnderOutputSchema.
function anthropicMessage() {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: "tu-1",
        name: "submit_prediction",
        input: {
          recommendation: "over",
          confidence_pct: 60,
          rationale: "Both teams score freely; weak defenses.",
          key_factors: ["high xG", "leaky defenses"],
          minimum_odd: 1.8,
        },
      },
    ],
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

// Wires every happy-path mock. Individual tests override one spy to inject the
// failure under test.
function setHappyPath() {
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLineups.mockResolvedValue(LINEUPS);
  getOddsForSport.mockResolvedValue([ODDS_EVENT]);
  // Default: no fresh snapshot, so every existing test keeps exercising the
  // getOddsForSport fallback path unchanged.
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(null);
  // Catálogo over/under resolvido: marketId + os mapas seleção↔id que predict()
  // usa pra selection_id (prediction) e pras rows do candidate set (PSO).
  resolveMarketCatalog.mockResolvedValue({
    marketId: "mkt-ou",
    idByKey: new Map([
      ["over", "sel-over"],
      ["under", "sel-under"],
    ]),
    keyById: new Map([
      ["sel-over", "over"],
      ["sel-under", "under"],
    ]),
  });
  // Default global resolvido pelo DB quando não há override nem preferência.
  getDefaultModelId.mockResolvedValue("claude-opus-4-8");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  // Sem preferência por padrão — cada teste que exercita a preferência sobrescreve.
  getPreferredModelId.mockResolvedValue(null);
  anthropicCreate.mockResolvedValue(anthropicMessage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setHappyPath();
});

describe("predict() — graceful degrade on transient injuries error", () => {
  it("baseline: happy path resolves and calls Anthropic", async () => {
    const spy = vi.spyOn(overUnderCartridge, "buildPredictionInput");
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: false,
    });
    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    expect(result.marketKey).toBe("over_under");
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    // Seam-guard (gate #23): predict DEVE despachar via o cartucho exatamente uma vez.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].home.absencesAvailable).toBe(true);
    expect(spy.mock.calls[0]?.[0].away.absencesAvailable).toBe(true);
  });

  it("Test A: transient injuries error degrades to absencesAvailable=false and proceeds", async () => {
    getInjuriesByFixture.mockRejectedValueOnce(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getInjuriesByFixture",
        new Error("503"),
      ),
    );
    const spy = vi.spyOn(overUnderCartridge, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0]?.[0];
    expect(args?.home.absencesAvailable).toBe(false);
    expect(args?.away.absencesAvailable).toBe(false);
    // Degraded payload forwarded to buildPredictionInput is the empty shape.
    expect(args?.home.injuries).toEqual([]);
    expect(args?.away.injuries).toEqual([]);
    // Analysis proceeded: the paid LLM call still happened.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("Test C (regression): unsupported injuries error still degrades to absencesAvailable=false", async () => {
    getInjuriesByFixture.mockRejectedValueOnce(
      new SportsDataUnsupportedError(
        "no injury endpoint",
        "football-data-org",
        "getInjuriesByFixture",
      ),
    );
    const spy = vi.spyOn(overUnderCartridge, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0]?.[0];
    expect(args?.home.absencesAvailable).toBe(false);
    expect(args?.away.absencesAvailable).toBe(false);
    // Degraded payload forwarded to buildPredictionInput is the empty shape.
    expect(args?.home.injuries).toEqual([]);
    expect(args?.away.injuries).toEqual([]);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — transient error on a CRITICAL fetch is NOT over-caught", () => {
  it("Test B: transient error on getTeamForm rejects predict() with no paid LLM call", async () => {
    getTeamForm.mockRejectedValue(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getTeamForm",
        new Error("503"),
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      SportsDataTransientError,
    );
    // No paid LLM call when a required fetch fails (cost safety).
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("Test B': transient error on getStandings also rejects predict() with no paid LLM call", async () => {
    getStandings.mockRejectedValue(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getStandings",
        new Error("503"),
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      SportsDataTransientError,
    );
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("Test D: a NON-degradeable injuries error (SportsDataNotFoundError) bubbles up and does NOT call the LLM", async () => {
    // The injuries catch maps ONLY SportsDataTransientError and
    // SportsDataUnsupportedError to the degraded signal; every other error must
    // re-throw (reject predict) and never reach the paid LLM call. This pins the
    // `throw err` branch so broadening the catch to swallow all errors regresses.
    getInjuriesByFixture.mockRejectedValue(
      new SportsDataNotFoundError(
        "fixture has no injury entity",
        "api-football",
        "getInjuriesByFixture",
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      SportsDataNotFoundError,
    );
    // No degrade, no analysis: the paid LLM call must not happen.
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});

describe("predict() — odds snapshot reuse vs. fallback", () => {
  it("fresh snapshot present → predict uses it and does NOT call getOddsForSport", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(FRESH_SNAPSHOT);
    const spy = vi.spyOn(overUnderCartridge, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    // Quota guarantee: the snapshot path skips the Odds API entirely.
    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);

    // O cartucho recebe o GENERIC args (selections[]/pct), não o shape binário —
    // predict monta UM args genérico. Prova o Number() das colunas string no
    // boundary: '1.900'/'1.950' → 1.9/1.95 nas selections; bookmaker passthrough.
    const odds = spy.mock.calls[0]?.[0].odds;
    expect(odds?.selections).toEqual([
      { key: "over", odd: 1.9 },
      { key: "under", odd: 1.95 },
    ]);
    expect(odds?.bookmaker).toBe("Pinnacle");
  });

  it("no fresh snapshot → predict falls back to getOddsForSport", async () => {
    // setHappyPath default already stubs getLatestFreshSelectionOddsSnapshots → null.
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(getOddsForSport).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — congelamento do par de odds na prediction (#104)", () => {
  it("over: persists the frozen pair (toFixed(3)) plus bookmaker alongside the recommended-side columns", async () => {
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    // insertValues[0] = ai_calls; [1] = predictions.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("over");
    // Par congelado agora na PSO (over+under), byte-idêntico ao par legado.
    const psoByKey = psoOddByKey(insertValues.mock.calls[2]?.[0]);
    expect(psoByKey["sel-over"]).toBe("1.900");
    expect(psoByKey["sel-under"]).toBe("1.950");
    expect(predictionRow.bookmaker).toBe("Pinnacle");
    // Colunas do lado recomendado preservadas (over → odd do over).
    expect(predictionRow.oddAtRecommendation).toBe("1.900");
  });

  it("pass: persists the frozen pair AND bookmaker with null recommended-side columns", async () => {
    // Fixture SEM minimum_odd — o superRefine do OverUnderOutputSchema proíbe
    // minimum_odd quando recommendation é "pass".
    anthropicCreate.mockResolvedValue({
      ...anthropicMessage(),
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "submit_prediction",
          input: {
            recommendation: "pass",
            confidence_pct: 53,
            rationale: "Edge too thin on both sides.",
            key_factors: ["balanced market"],
          },
        },
      ],
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    // Par congelado (na PSO) + bookmaker persistidos também em pass (ADR 0012).
    const psoByKey = psoOddByKey(insertValues.mock.calls[2]?.[0]);
    expect(psoByKey["sel-over"]).toBe("1.900");
    expect(psoByKey["sel-under"]).toBe("1.950");
    expect(predictionRow.bookmaker).toBe("Pinnacle");
    // Sem lado recomendado: colunas de recomendação continuam null.
    expect(predictionRow.oddAtRecommendation).toBeNull();
    expect(predictionRow.impliedProbPct).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.minimumOdd).toBeNull();
  });
});

// ─── Paridade #165: colunas legadas byte-idênticas + colunas novas + PSO ─────

// Captura fresca N-vias com odds arbitrárias (path conservador reuse) — controla
// os bytes exatos sem depender do fallback de rede. Shape LatestSelectionSnapshot.
function freshSnapshotWith(overOdd: string, underOdd: string) {
  return {
    bookmaker: "Pinnacle",
    capturedAt: new Date(),
    overroundPct: "3.50",
    selections: [
      { key: "over", odd: overOdd },
      { key: "under", odd: underOdd },
    ],
  };
}

// Output mockado fixo (sem API paga) com a recomendação e confiança dadas.
function toolUseMessage(input: Record<string, unknown>) {
  return {
    ...anthropicMessage(),
    content: [{ type: "tool_use", id: "tu-1", name: "submit_prediction", input }],
  };
}

// Implícita normalizada do lado, na MESMA ordem de operações do predict
// (probs[idx] * 100), pra comparar o byte do .toFixed(2) gravado.
function impliedPctOf(over: number, under: number, side: "over" | "under") {
  const { probs } = computeMarketImpliedProbabilities([over, under]);
  return (side === "over" ? probs[0] : probs[1]) * 100;
}

// PSO (prediction_selection_odds) é a 3ª chamada de insert: selectionId → odd.
// O par over/under congelado vive aqui (Fase 5 dropou as colunas legadas
// over/underOddAtPrediction); estes asserts substituem os antigos por coluna.
function psoOddByKey(call: unknown): Record<string, string> {
  const rows = (call ?? []) as Array<{ selectionId: string; odd: string }>;
  return Object.fromEntries(rows.map((r) => [r.selectionId, r.odd]));
}

describe("predict() — paridade de colunas (#165): legado byte-idêntico + novas + PSO", () => {
  it("over assimétrico (2.10/1.74): legado byte-idêntico + market/selection/params + PSO == par congelado", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: 60,
        rationale: "Jogo aberto.",
        key_factors: ["alto xG", "defesas vazadas"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // Legado byte-idêntico (mesma matemática de implied/edge que predict.ts:367-372).
    const impliedOver = impliedPctOf(2.1, 1.74, "over");
    expect(predictionRow.recommendation).toBe("over");
    expect(predictionRow.oddAtRecommendation).toBe("2.100");
    expect(predictionRow.impliedProbPct).toBe(impliedOver.toFixed(2));
    expect(predictionRow.edgePct).toBe((60 - impliedOver).toFixed(2));
    expect(predictionRow.confidencePct).toBe("60.00");
    expect(predictionRow.minimumOdd).toBe("1.800");
    // stake_units agora é gravado pela banda determinística (#167 / ADR 0019).
    // edge = 60 − implied(2.10) = 14.69 (≥ 12) e conf 60 (≥ 55) → 3u → "3.00".
    expect(predictionRow.stakeUnits).toBe("3.00");
    // Colunas NOVAS multi-mercado.
    expect(predictionRow.marketId).toBe("mkt-ou");
    expect(predictionRow.selectionId).toBe("sel-over");
    expect(predictionRow.marketParams).toEqual({ line: 2.5 });

    // PSO: candidate set completo (over+under), odds == par congelado byte-a-byte.
    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      predictionId: string;
      selectionId: string;
      odd: string;
    }>;
    expect(psoRows).toHaveLength(2);
    const byKey = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.odd]),
    );
    expect(byKey["sel-over"]).toBe("2.100");
    expect(byKey["sel-under"]).toBe("1.740");
    expect(psoRows.every((r) => r.predictionId === "row-1")).toBe(true);
  });

  it("recommendation=under: impliedProbPct/edgePct do lado under byte-idênticos ao legado", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "under",
        confidence_pct: 58,
        rationale: "Poucos gols esperados.",
        key_factors: ["defesas sólidas", "ritmo baixo"],
        minimum_odd: 1.7,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedUnder = impliedPctOf(2.1, 1.74, "under");
    expect(predictionRow.recommendation).toBe("under");
    expect(predictionRow.selectionId).toBe("sel-under");
    expect(predictionRow.oddAtRecommendation).toBe("1.740");
    expect(predictionRow.impliedProbPct).toBe(impliedUnder.toFixed(2));
    expect(predictionRow.edgePct).toBe((58 - impliedUnder).toFixed(2));
  });

  it("pass: selectionId null + PSO grava AMBAS as seleções do candidate set", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "pass",
        confidence_pct: 51,
        rationale: "Edge fino dos dois lados.",
        key_factors: ["mercado equilibrado", "dados rasos"],
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.selectionId).toBeNull();
    expect(predictionRow.marketId).toBe("mkt-ou");
    expect(predictionRow.marketParams).toEqual({ line: 2.5 });

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      selectionId: string;
      odd: string;
    }>;
    expect(psoRows).toHaveLength(2);
    const ids = psoRows.map((r) => r.selectionId).sort();
    expect(ids).toEqual(["sel-over", "sel-under"]);
    const byKey = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.odd]),
    );
    expect(byKey["sel-over"]).toBe("1.900");
    expect(byKey["sel-under"]).toBe("1.950");
  });

  it("partial PSO failure após prediction commitada: degrada (não-throw), retorna a prediction", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    // 3º insert (PSO) falha; os 2 primeiros (ai_calls, predictions) passam.
    let call = 0;
    insertValues.mockImplementation(() => {
      call += 1;
      if (call === 3) throw new Error("PSO write failed");
    });

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: false,
    });
    // A prediction foi retornada apesar da falha do candidate set (carrier #173).
    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    expect(insertValues).toHaveBeenCalledTimes(3);
  });
});

// ─── #167 / ADR 0019: stake congelado na row pela banda determinística ───────
//
// Steeramos o EDGE pelas odds (freshSnapshotWith) + a confiança pelo output
// mockado, pra cair INTERIOR a cada banda — a fronteira EXATA dos operadores
// fica no staking.test (implícita normalizada é irracional, não bate número
// redondo). impliedPctOf replica a conta do predict (probs[idx]*100) pra derivar
// o edge esperado. O stake é gravado como STRING (numeric(6,2) → toFixed(2)).
describe("predict() — stake congelado na row (#167 / ADR 0019)", () => {
  it("1u: edge baixo (4.35) com conf 55 → stake_units '1.00'", async () => {
    // implied(over | 1.90/1.95) ≈ 50.65; edge = 55 − 50.65 = 4.35 (< 8) → 1u.
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: 55,
        rationale: "Jogo equilibrado, edge fino.",
        key_factors: ["mercado apertado"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedOver = impliedPctOf(1.9, 1.95, "over");
    expect(predictionRow.edgePct).toBe((55 - impliedOver).toFixed(2));
    expect(predictionRow.stakeUnits).toBe("1.00");
  });

  it("2u: edge 9.69 com conf 55 → stake_units '2.00'", async () => {
    // implied(over | 2.10/1.74) ≈ 45.31; edge = 55 − 45.31 = 9.69 (∈ [8,12)) e
    // conf 55 (≥ 50) → 2u.
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: 55,
        rationale: "Edge sólido no over.",
        key_factors: ["alto xG"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedOver = impliedPctOf(2.1, 1.74, "over");
    expect(predictionRow.edgePct).toBe((55 - impliedOver).toFixed(2));
    expect(predictionRow.stakeUnits).toBe("2.00");
  });

  it("3u: edge 18.00 com conf 58 → stake_units '3.00'", async () => {
    // implied(over | 2.40/1.60) = 40.00; edge = 58 − 40 = 18 (≥ 12) e conf 58
    // (≥ 55) → 3u.
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.400", "1.600"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: 58,
        rationale: "Edge forte e convicção alta.",
        key_factors: ["defesas vazadas", "alto xG"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedOver = impliedPctOf(2.4, 1.6, "over");
    expect(predictionRow.edgePct).toBe((58 - impliedOver).toFixed(2));
    expect(predictionRow.stakeUnits).toBe("3.00");
  });

  it("pass: edge null → stake_units '1.00' (default, irrelevante no Yield)", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "pass",
        confidence_pct: 70,
        rationale: "Sem edge claro.",
        key_factors: ["mercado eficiente"],
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    // edge null → 1u mesmo com conf alta (não dimensiona sem edge).
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.stakeUnits).toBe("1.00");
  });

  it("rounding-seam: raw edge 7.997 < 8 mas edge_pct congela '8.00' → 2u (banda decide sobre o valor GRAVADO)", async () => {
    // implied(over | 2.10/1.74) = 45.3125. confidence_pct = implied + 7.997 =
    // 53.3095: o edge raw é 7.997 (< 8 → daria 1u sem o fix), mas toFixed(2) o
    // arredonda pra "8.00". A banda decide sobre o "8.00" CONGELADO na row (não
    // sobre 7.997), então grava 2u — caso contrário a banda divergiria do
    // edge_pct visível (ADR 0019, auditabilidade).
    const impliedOver = impliedPctOf(2.1, 1.74, "over"); // 45.3125
    const confSeam = impliedOver + 7.997; // 53.3095
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: confSeam,
        rationale: "Edge no limiar do arredondamento.",
        key_factors: ["caso de seam"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // Sanidade: o raw edge é mesmo < 8, mas o byte gravado é "8.00".
    expect(confSeam - impliedOver).toBeLessThan(8);
    expect(predictionRow.edgePct).toBe("8.00");
    expect(predictionRow.stakeUnits).toBe("2.00");
  });

  it("rounding-seam (confiança): raw conf 49.996 < 50 mas confidence_pct congela '50.00' → 2u", async () => {
    // O fix arredonda OS DOIS eixos antes de bandar; este é o seam SIMÉTRICO ao de
    // cima, no eixo da CONFIANÇA. implied(over | 2.40/1.60) = 40.00; conf raw =
    // 49.996 (< 50 → daria 1u sem o freeze da confiança) arredonda pra "50.00".
    // O edge fica firme em ~9.996 (∈ [8,12)), então SÓ a confiança está no seam: a
    // banda decide sobre o "50.00" CONGELADO → 2u (não sobre 49.996 → 1u).
    const impliedOver = impliedPctOf(2.4, 1.6, "over"); // 40.00
    const confSeam = 49.996;
    getLatestFreshSelectionOddsSnapshots.mockResolvedValueOnce(
      freshSnapshotWith("2.400", "1.600"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: confSeam,
        rationale: "Confiança no limiar do arredondamento.",
        key_factors: ["caso de seam (confiança)"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // Sanidade: conf raw < 50 e edge firmemente ≥ 8 (só a confiança está no seam).
    expect(confSeam).toBeLessThan(50);
    expect(confSeam - impliedOver).toBeGreaterThanOrEqual(8);
    expect(predictionRow.confidencePct).toBe("50.00");
    expect(predictionRow.stakeUnits).toBe("2.00");
  });
});

describe("predict() — over_under_v2.1: snapshot literal do prompt (guard anti-drift) + proveniência #226", () => {
  it("cartridge.systemPrompt: snapshot literal (regra 8 agora pondera proveniência — #226, ADR 0026)", () => {
    // v2.0→v2.1 (#226): a regra 8 ganhou a cláusula de proveniência (`fonte`
    // oficial/não-oficial) PRESERVANDO "dados indisponíveis != elenco saudável".
    // Snapshot LITERAL da string INTEIRA — não um toContain de trecho. É o único guard
    // automático contra drift silencioso do prompt: QUALQUER mudança de UM caractere
    // quebra este teste (e exige bump consciente de versão).
    expect(overUnderCartridge.version).toBe("over_under_v2.1");
    expect(overUnderCartridge.systemPrompt).toMatchInlineSnapshot(`
      "Você é um analista quantitativo de apostas esportivas focado exclusivamente no mercado over/under 2.5 gols.

      Sua única tarefa é decidir, para o jogo descrito pelo usuário, entre três opções:
      - "over": apostar em mais de 2.5 gols totais
      - "under": apostar em menos de 2.5 gols totais
      - "pass": não recomendar aposta neste jogo

      Regras invioláveis:
      1. Recomende "over" ou "under" SOMENTE se sua probabilidade estimada (confidence_pct) supera a probabilidade implícita normalizada do lado correspondente em pelo menos 5 pontos percentuais (edge >= 5%). Caso contrário, retorne "pass".
      2. "pass" é a opção segura por padrão e um resultado válido e esperado. Em caso de dúvida, passe a vez. Não force uma recomendação.
      3. confidence_pct é sua probabilidade estimada para o LADO RECOMENDADO. Quando "pass", reporte sua melhor estimativa para "over".
      4. minimum_odd: odd decimal mínima na qual o palpite ainda mantém edge >= 5%. Obrigatório quando recommendation ∈ {"over","under"}; OMITIR quando "pass".
      5. Use APENAS os dados fornecidos pelo usuário. Não invente jogadores, lesões, escalações, estatísticas ou tendências.
      6. Raciocine quantitativamente quando possível: médias de gols marcados/sofridos, ritmo recente, impacto de ausências em finalização/defesa, padrão de H2H, contexto da competição.
      7. Considere a confiabilidade dos dados: poucos jogos de forma recente, ausência de escalação publicada, ou H2H muito antigo são motivos pra reduzir confiança (e provavelmente "pass").
      8. Quando a seção "Lesões / Suspensões" indicar "dados indisponíveis nesta análise" para um time, NÃO assuma que não há lesões — trate como dado faltante e reduza a confiança da análise. Quando um desfalque trouxer uma "fonte": "official" é dado estruturado confiável (peso normal na leitura); "unofficial" é fonte não-oficial/fallback — trate com cautela (menor peso; não deixe um desfalque não-oficial sozinho dominar a recomendação). Sem "fonte" indicada, assuma confiável. Isso NÃO altera a regra acima: "dados indisponíveis" continua significando dado faltante, NUNCA elenco saudável.
      9. Responda EXCLUSIVAMENTE chamando a ferramenta \`submit_prediction\` com os campos definidos no schema dela. Não produza texto livre fora da chamada da ferramenta.

      Redação do campo rationale (tom, não conteúdo):
      - Estas regras mudam APENAS a forma de escrever o rationale. A decisão (recommendation, confidence_pct, minimum_odd) segue exclusivamente as regras invioláveis acima — decida primeiro como sempre; na dúvida sobre o edge mínimo, continue passando a vez.
      - Escreva para um leitor leigo, que NÃO conhece estatística de apostas: frases curtas, linguagem do dia a dia.
      - Abra com a conclusão em UMA frase simples (ex.: "Este jogo tem boas chances de terminar com 3 gols ou mais." / "Melhor não apostar neste jogo.").
      - Depois da conclusão, sustente com os números decisivos (médias de gols, forma recente, ausências, histórico do confronto) — a base quantitativa continua obrigatória; muda só o tom.
      - Jargão técnico apenas se explicado em meia frase no próprio texto (ex.: "probabilidade implícita — a chance que a odd embute"). Prefira "histórico de confrontos" a "H2H".
      - Não exagere a convicção pra soar didático: a frase de abertura deve refletir sua incerteza real (um caso apertado abre com "por pouco", não com certeza).
      - Mantenha o tamanho de sempre: ~450 caracteres (máx. 600). Linguagem acessível não significa texto mais longo."
    `);
  });

  it("buildUserMessage renderiza byte-idêntico ao v1.3 pro mesmo input (string-equality completa)", () => {
    // Snapshot LITERAL da mensagem markdown INTEIRA renderizada pro fixture abaixo
    // (não toContain de blocos). Pareia com o snapshot do systemPrompt: juntos
    // travam o PAYLOAD completo (system + user) contra qualquer drift silencioso.
    const input = buildPredictionInput({
      match: {
        externalId: "ext-1",
        league: "brasileirao_a",
        homeTeam: matchRow.homeTeam,
        awayTeam: matchRow.awayTeam,
        kickoffAt: matchRow.kickoffAt,
        venue: "Maracanã",
      },
      standings: STANDINGS,
      home: { form: [], injuries: [], absencesAvailable: true },
      away: { form: [], injuries: [], absencesAvailable: true },
      lineups: undefined,
      h2h: [],
      // Args GENÉRICO (#173): selections[]/pct map. O cartucho DOWN-MAPEIA pro
      // OverUnderInput binário → a mensagem renderizada fica BYTE-IDÊNTICA (eval-noop;
      // o snapshot abaixo não muda). over_pct/under_pct viram pct.over/pct.under.
      odds: {
        bookmaker: "Pinnacle",
        captured_at: "2026-05-15T12:00:00.000Z",
        selections: [
          { key: "over", odd: 1.9 },
          { key: "under", odd: 1.95 },
        ],
      },
      implied: { pct: { over: 51.28, under: 48.72 } },
    });
    const message = overUnderCartridge.buildUserMessage(input, {
      daysToKickoff: 3,
    });
    expect(message).toMatchInlineSnapshot(`
      "# Jogo
      - Competição: brasileirao_a
      - Mandante: CR Flamengo
      - Visitante: Fluminense FC
      - Kickoff (UTC): 2026-05-15T19:00:00.000Z
      - Local: Maracanã

      # Mandante — CR Flamengo
      ## Classificação
      - Posição: 1, 20 pts em 10 jogos
      - Gols: 18 pró / 9 contra (saldo 9)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Visitante — Fluminense FC
      ## Classificação
      - Posição: 2, 18 pts em 10 jogos
      - Gols: 15 pró / 10 contra (saldo 5)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Confrontos diretos (H2H)
      - (sem histórico fornecido)

      # Odds e probabilidades implícitas
      - Bookmaker: Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Over 2.5: odd 1.90 → implícita normalizada 51.28%
      - Under 2.5: odd 1.95 → implícita normalizada 48.72%

      # Contexto temporal
      - Dias até o jogo: 3 (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)

      # Sua tarefa
      Decida: "over", "under" ou "pass". Aplique a regra de edge >= 5%. Chame a ferramenta submit_prediction com os campos do schema."
    `);
  });
});

describe("predict() — model resolution (override > DB default) + model-aware request", () => {
  it("no override + DB default Opus → Anthropic called with opus id and NO temperature (adaptive)", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(arg).not.toHaveProperty("temperature");
    expect(arg.thinking).toEqual({ type: "adaptive" });
    // CRÍTICO: o caminho default/non-admin é Opus 4.8 — forced tool_choice +
    // thinking dá 400 em produção. O payload real DEVE usar `auto`, nunca forçar.
    expect(arg.tool_choice).toEqual({ type: "auto" });

    // Critério de aceite do #57: as colunas de auditoria refletem o modelo
    // RESOLVIDO, não o `response.model` (que aqui é o id stale "sonnet" do mock).
    // ai_calls é inserido primeiro, predictions depois.
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-opus-4-8");
    expect(predictionRow.modelVersion).toBe("claude-opus-4-8");
  });

  it("a request carrega o max_tokens configurado com folga pro thinking (guarda o bug stopReason max_tokens)", async () => {
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.max_tokens).toBe(16000);
    // folga mínima: abaixo disso o thinking dos modelos adaptive estoura antes do tool_use
    expect(arg.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("modelOverride Sonnet wins over DB default Opus → sonnet id + temperature 0.3", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");
    // Resposta carrega um `model` STALE (≠ id resolvido) pra provar que as
    // colunas de auditoria gravam o id RESOLVIDO, não `response.model`.
    anthropicCreate.mockResolvedValueOnce({
      ...anthropicMessage(),
      model: "claude-opus-4-8",
    });

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-sonnet-4-5-20250929",
      }),
    ).resolves.toBeDefined();

    // Override curto-circuita o lookup do default global.
    expect(getDefaultModelId).not.toHaveBeenCalled();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-sonnet-4-5-20250929");
    expect(arg.temperature).toBe(0.3);
    expect(arg).not.toHaveProperty("thinking");
    // Sonnet não usa thinking, então forçar o submit_prediction é válido.
    expect(arg.tool_choice).toEqual({
      type: "tool",
      name: "submit_prediction",
    });

    // Auditoria reflete o modelo RESOLVIDO (override), não o `response.model`
    // stale ("claude-opus-4-8") devolvido pelo provider acima.
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-sonnet-4-5-20250929");
    expect(predictionRow.modelVersion).toBe("claude-sonnet-4-5-20250929");
  });

  it("modelOverride Haiku → haiku id + temperature 0.3 (temperature mode), skips DB default", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-haiku-4-5",
      }),
    ).resolves.toBeDefined();

    // Override curto-circuita AMBOS os lookups (preferência E default global).
    expect(getPreferredModelId).not.toHaveBeenCalled();
    expect(getDefaultModelId).not.toHaveBeenCalled();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    expect(arg.temperature).toBe(0.3);
    expect(arg).not.toHaveProperty("thinking");

    // Auditoria reflete o modelo resolvido (override).
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
    expect(predictionRow.modelVersion).toBe("claude-haiku-4-5");
  });

  it("no override + DB default Sonnet → Anthropic called with sonnet id", async () => {
    getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-sonnet-4-5-20250929");
    expect(arg.temperature).toBe(0.3);
  });
});

describe("predict() — cascata completa: preferência do usuário + filtro de audiência", () => {
  it("sem override + preferência Haiku (não-admin) → usa Haiku; default global NÃO é lido", async () => {
    getPreferredModelId.mockResolvedValue("claude-haiku-4-5");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    // Preferência válida curto-circuita o default global.
    expect(getDefaultModelId).not.toHaveBeenCalled();

    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
  });

  it("QUEDA GRACIOSA: preferência stale/removida (ex.: Fable após #241) → getPreferredModelId devolve null → cai no default global", async () => {
    // getPreferredModelId (query real) filtra ids fora do registry pra null, então
    // um preferredModelId='claude-fable-5' antigo no DB nunca chega à cascata: a
    // predict recai no default global. Sem mudança de runtime — só confirma a queda.
    getPreferredModelId.mockResolvedValue(null);
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
  });

  it("sem override + preferência Sonnet 4.5 (promovido em #240) + isAdmin=false → usa Sonnet 4.5", async () => {
    // Sonnet 4.5 agora é userSelectable, então passa no filtro de audiência até
    // pro usuário comum — a preferência válida curto-circuita o default global.
    getPreferredModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-sonnet-4-5-20250929");
    expect(getDefaultModelId).not.toHaveBeenCalled();
  });

  it("override sempre vence a preferência: override Haiku + preferência Sonnet → usa Haiku", async () => {
    getPreferredModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-haiku-4-5",
      }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    // Override curto-circuita preferência E default.
    expect(getPreferredModelId).not.toHaveBeenCalled();
    expect(getDefaultModelId).not.toHaveBeenCalled();
  });

  it("sem override + sem preferência (null) + default Opus → Opus (comportamento atual preservado)", async () => {
    getPreferredModelId.mockResolvedValue(null);
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — Opus adaptive path: model declines to call the tool", () => {
  it("no submit_prediction tool_use (thinking/text only) → persists tool_missing ai_call, still paid, and throws", async () => {
    // Caminho Opus: tool_choice é `auto` (forced + thinking = 400), então o
    // modelo PODE não chamar submit_prediction — só devolver thinking/texto.
    // predict() deve registrar o ai_call pago (tokens cobrados) com status
    // tool_missing E lançar; nenhuma prediction é inserida.
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");
    anthropicCreate.mockResolvedValue({
      id: "msg-2",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [
        { type: "thinking", thinking: "ponderando o jogo...", signature: "sig" },
        { type: "text", text: "Não tenho convicção suficiente." },
      ],
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      "LLM did not call submit_prediction tool",
    );

    // A chamada paga ao LLM aconteceu (custo real) e foi auditada como
    // tool_missing — exatamente UM insert (ai_calls), nenhuma prediction.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as {
      model: string;
      status: string;
      inputTokens: number;
      outputTokens: number;
    };
    expect(aiCallRow.status).toBe("tool_missing");
    // Modelo resolvido (Opus), não o response.model, e tokens cobrados.
    expect(aiCallRow.model).toBe("claude-opus-4-8");
    expect(aiCallRow.inputTokens).toBe(1200);
    expect(aiCallRow.outputTokens).toBe(300);
  });
});

describe("predict() — error paths: invariante 1 ai_call / 0 prediction / 0 PSO", () => {
  // Espelha o teste de tool_missing acima pras OUTRAS duas classes de erro do
  // PLAN-165 (invalid_output, provider_error): cada uma persiste EXATAMENTE um
  // ai_call (a auditoria do erro via persistAiCallError) e ZERO prediction/PSO.

  it("invalid_output: output do LLM falha o Zod do cartucho → 1 ai_call, 0 prediction, 0 PSO, throws", async () => {
    // tool_use VÁLIDO (o modelo chamou submit_prediction), mas o input falha o
    // outputSchema do cartucho — confidence_pct fora do range [0,100]. predict()
    // audita como invalid_output (1 insert em ai_calls) e lança; nenhuma
    // prediction nem candidate set é escrito.
    anthropicCreate.mockResolvedValue({
      id: "msg-3",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        {
          type: "tool_use",
          id: "tu-2",
          name: "submit_prediction",
          input: {
            recommendation: "over",
            confidence_pct: 150, // inválido: > 100, viola z.number().max(100)
            rationale: "Defesas frágeis dos dois lados.",
            key_factors: ["xG alto", "defesas vazadas"],
            minimum_odd: 1.8,
          },
        },
      ],
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("LLM output failed Zod validation");

    // A chamada paga aconteceu; auditada como invalid_output — UM insert
    // (ai_calls via persistAiCallError), nenhuma prediction, nenhum PSO.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { status: string };
    expect(aiCallRow.status).toBe("invalid_output");
  });

  it("provider_error: client.messages.create rejeita (Anthropic.APIError) → 1 ai_call, 0 prediction, 0 PSO, throws", async () => {
    // A chamada paga estoura com um erro do provider. classifyAnthropicError
    // mapeia APIError → provider_error; persistAiCallError grava UM ai_call
    // (tokens 0) e predict() relança como PredictError. Nenhuma prediction/PSO.
    anthropicCreate.mockRejectedValue(
      new Anthropic.APIError(
        500,
        undefined,
        "internal server error",
        undefined,
      ),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("anthropic call failed");

    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { status: string };
    expect(aiCallRow.status).toBe("provider_error");
  });
});

// ─── #175: caminho MULTI-LINHA (over_under v3.0, extraLines:true) ────────────
//
// Com extraLines:true, getCartridge resolve o cartucho v3 (descriptor OVER_UNDER_ALT,
// candidateLines [1.5,2.5,3.5]). predict lê o snapshot fresco UMA VEZ POR LINHA
// (getLatestFreshSelectionOddsSnapshots com params:{line}), monta a escada pro LLM,
// e — após o output INCLUIR `line` — FIXA o bundle/odds/implícita DAQUELA linha pra
// todo o downstream (edge/PSO). marketParams = a linha ESCOLHIDA (resolveParams),
// NÃO descriptor.params; o par congelado da linha vive na PSO (o enum legado `market`
// e o par over/underOddAtPrediction saíram na Fase 5).
//
// Bundles DISTINTOS por linha pra provar que predict usa as odds da linha CERTA: a
// escada tem odds bem diferentes por linha, e os asserts checam que as colunas
// gravadas batem com a linha ESCOLHIDA pelo LLM (não com a 2.5 nem a head da escada).
const LINE_SNAPSHOTS: Record<number, ReturnType<typeof freshSnapshotWith>> = {
  1.5: freshSnapshotWith("1.300", "3.500"),
  2.5: freshSnapshotWith("1.900", "1.950"),
  3.5: freshSnapshotWith("3.400", "1.320"),
};

// Mock POR-LINHA: predict chama getLatestFreshSelectionOddsSnapshots({matchId,
// dbMarketKey, params:{line}}) uma vez por candidateLine. Despacha pelo `line` do
// arg. Linha fora do mapa → null (escada parcial — não acontece nestes testes).
function wireMultiLineSnapshots() {
  getLatestFreshSelectionOddsSnapshots.mockImplementation(
    (arg: { params?: { line?: number } }) => {
      const line = arg?.params?.line;
      return Promise.resolve(
        line !== undefined ? (LINE_SNAPSHOTS[line] ?? null) : null,
      );
    },
  );
}

describe("predict() — multi-linha (#175): linha escolhida round-trip pro persist", () => {
  it("LLM escolhe 3.5: marketParams {line:3.5}, market enum null, odds/edge da 3.5 (não 2.5)", async () => {
    wireMultiLineSnapshots();
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        line: 3.5,
        confidence_pct: 60,
        rationale: "Jogo com tendência de muitos gols.",
        key_factors: ["alto xG", "defesas vazadas"],
        minimum_odd: 2.5,
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: false,
      marketKey: "over_under",
      extraLines: true,
    });
    // Resolveu o cartucho v3 (promptVersion bate na ai_call).
    expect(result.marketKey).toBe("over_under");
    // Um snapshot lido POR linha candidata (1.5/2.5/3.5) = 3 chamadas.
    expect(getLatestFreshSelectionOddsSnapshots).toHaveBeenCalledTimes(3);

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // Linha escolhida round-trip → marketParams (settlement lê daqui).
    expect(predictionRow.marketParams).toEqual({ line: 3.5 });
    // Par congelado (na PSO) = odds da 3.5 (NÃO 2.5 "1.900"/"1.950").
    const psoByKey = psoOddByKey(insertValues.mock.calls[2]?.[0]);
    expect(psoByKey["sel-over"]).toBe("3.400");
    expect(psoByKey["sel-under"]).toBe("1.320");
    expect(predictionRow.oddAtRecommendation).toBe("3.400");
    // edge computado da implícita da 3.5 (não da 2.5).
    const impliedOver35 = impliedPctOf(3.4, 1.32, "over");
    expect(predictionRow.impliedProbPct).toBe(impliedOver35.toFixed(2));
    expect(predictionRow.edgePct).toBe((60 - impliedOver35).toFixed(2));
    // promptVersion do cartucho v3 na ai_call (insertValues[0]).
    const aiCallRow = insertValues.mock.calls[0]?.[0] as {
      promptVersion: string;
    };
    expect(aiCallRow.promptVersion).toBe("over_under_v3.1");
  });

  it("LLM escolhe 2.5: odds/edge da 2.5 (PSO da linha escolhida, não 1.5 nem 3.5)", async () => {
    wireMultiLineSnapshots();
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        line: 2.5,
        confidence_pct: 62,
        rationale: "Edge sólido na linha do meio.",
        key_factors: ["média alta de gols", "ritmo ofensivo"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        marketKey: "over_under",
        extraLines: true,
      }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.marketParams).toEqual({ line: 2.5 });
    // Par congelado (na PSO) = odds da 2.5 (NÃO 1.5 nem 3.5).
    const psoByKey = psoOddByKey(insertValues.mock.calls[2]?.[0]);
    expect(psoByKey["sel-over"]).toBe("1.900");
    expect(psoByKey["sel-under"]).toBe("1.950");
    expect(predictionRow.oddAtRecommendation).toBe("1.900");
    const impliedOver25 = impliedPctOf(1.9, 1.95, "over");
    expect(predictionRow.impliedProbPct).toBe(impliedOver25.toFixed(2));
    expect(predictionRow.edgePct).toBe((62 - impliedOver25).toFixed(2));
  });

  it("LLM dá PASS na 1.5: marketParams {line:1.5} persistido, sem edge/seleção, par da 1.5 congelado", async () => {
    wireMultiLineSnapshots();
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "pass",
        line: 1.5, // pass ainda reporta a linha avaliada → marketParams pra a view
        confidence_pct: 48, // P(over) em pass (convenção do schema)
        rationale: "Sem edge suficiente em nenhuma linha.",
        key_factors: ["linhas eficientes", "amostra curta"],
        // minimum_odd OMITIDO (v3 superRefine exige omissão em pass).
      }),
    );

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        marketKey: "over_under",
        extraLines: true,
      }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // A linha avaliada round-trip mesmo em pass (settlement ignora pass via void/0,
    // mas a view usa marketParams.line pros labels).
    expect(predictionRow.marketParams).toEqual({ line: 1.5 });
    expect(predictionRow.recommendation).toBe("pass");
    // pass → sem lado: nem seleção, nem odd@rec, nem edge/implícita.
    expect(predictionRow.selectionId).toBeNull();
    expect(predictionRow.oddAtRecommendation).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.impliedProbPct).toBeNull();
    // Par congelado (na PSO) = odds da linha ESCOLHIDA (1.5), inclusive em pass (ADR 0012).
    const psoByKey = psoOddByKey(insertValues.mock.calls[2]?.[0]);
    expect(psoByKey["sel-over"]).toBe("1.300");
    expect(psoByKey["sel-under"]).toBe("3.500");
  });

  it("LLM retorna uma linha FORA da escada resolvida → predict throws PredictError", async () => {
    // A escada resolvida cobre 1.5/2.5/3.5. O schema v3 só aceita esses valores
    // no `line`, então pra exercitar o guard de "linha fora da escada" derrubamos
    // a 2.5 da escada (mock por-linha devolve null pra 2.5) e fazemos o LLM
    // escolher 2.5: a linha passa no Zod mas não está em bundlesByLine → throw.
    getLatestFreshSelectionOddsSnapshots.mockImplementation(
      (arg: { params?: { line?: number } }) => {
        const line = arg?.params?.line;
        if (line === 2.5) return Promise.resolve(null); // 2.5 ausente da escada
        return Promise.resolve(
          line !== undefined ? (LINE_SNAPSHOTS[line] ?? null) : null,
        );
      },
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        line: 2.5, // válido no schema, mas FORA da escada resolvida
        confidence_pct: 60,
        rationale: "Escolha numa linha não disponível.",
        key_factors: ["caso de guard", "linha ausente"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        marketKey: "over_under",
        extraLines: true,
      }),
    ).rejects.toThrow(PredictError);
  });
});

describe("predict() — guarda de seed COMPLETO falha ANTES do gasto", () => {
  it("mercado seedado parcialmente (falta 'under') → throws ANTES de client.messages.create, 0 inserts", async () => {
    // resolveMarketCatalog (shared com #164) só hard-falha em mercado ausente ou
    // ZERO seleções. Um catálogo com SÓ 'over' passaria por ela e, sem a guarda
    // pré-paga, só quebraria nos hard-fails por-seleção DEPOIS da chamada paga —
    // queimando spend + uma row de ai_call. A guarda checa o seed COMPLETO antes
    // da chamada: predict() lança ANTES de tocar o LLM e sem nenhum insert.
    resolveMarketCatalog.mockResolvedValue({
      marketId: "mkt-ou",
      idByKey: new Map([["over", "sel-over"]]), // falta 'under'
      keyById: new Map([["sel-over", "over"]]),
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("seedado incompleto");

    // Falhou ANTES do gasto: nenhuma chamada paga ao LLM e nenhum insert
    // (nem ai_call, nem prediction, nem PSO).
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
