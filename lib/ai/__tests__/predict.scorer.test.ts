import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";

// Fork independent_binary (#290) do predict: artilheiro (bet_92). Mocka os mesmos
// boundaries que predict.test.ts + o catálogo lazy (resolveMarketRow/
// ensureScorerSelections) e o getOddsProvider (collectIndependentBinaries lê dele).

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

const getTeamForm = vi.fn();
const getH2H = vi.fn();
const getStandings = vi.fn();
const getLineups = vi.fn();
const getFixtureByMatch = vi.fn();
const getInjuriesByFixture = vi.fn();

vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: vi.fn((): SportsDataProvider => {
    const capabilities: ProviderCapabilities = {
      name: "mock",
      supportsInjuries: true,
      supportsLineups: true,
      supportsFixtureEvents: true,
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

const oddsGetOddsForSport = vi.fn();
vi.mock("@/lib/providers/odds", () => ({
  getOddsProvider: () => ({ getOddsForSport: oddsGetOddsForSport }),
}));

const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...args: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...args),
}));

const resolveMarketRow = vi.fn();
const ensureScorerSelections = vi.fn();
const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketRow: (...args: unknown[]) => resolveMarketRow(...args),
  ensureScorerSelections: (...args: unknown[]) => ensureScorerSelections(...args),
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

import { predict } from "@/lib/ai/predict";

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

// Evento de odds bet_92 (artilheiro): 2 jogadores yes-only.
const SCORER_EVENT: NormalizedOddsEvent = {
  id: "evt-1",
  commenceTime: REF.kickoffAt,
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  bookmakers: [
    {
      key: "apifootball_8",
      title: "Bet365",
      markets: [
        {
          key: "bet_92",
          lastUpdate: "2026-05-15T12:00:00Z",
          outcomes: [
            { name: "Pedro", price: 2.5 },
            { name: "Arrascaeta", price: 4.0 },
          ],
        },
      ],
    },
  ],
};

function anthropicMessage(input: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [
      { type: "tool_use", id: "tu-1", name: "submit_prediction", input },
    ],
  } as unknown as Anthropic.Message;
}

beforeEach(() => {
  // #231: predict tem backstop hasKey() (client mockado → só a PRESENÇA importa).
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  vi.clearAllMocks();
  // #385: gate de predict() exige kickoff > Date.now(); congela ANTES do kickoff.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getLineups.mockResolvedValue(undefined);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(null);
  oddsGetOddsForSport.mockResolvedValue([SCORER_EVENT]);
  resolveMarketRow.mockResolvedValue({ marketId: "mkt-scorer" });
  ensureScorerSelections.mockResolvedValue({
    idByKey: new Map([
      ["scorer_pedro", "sel-pedro"],
      ["scorer_arrascaeta", "sel-arrascaeta"],
    ]),
  });
  getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  getPreferredModelId.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("predict — anytime_scorer (independent_binary fork)", () => {
  it("busca bet_92, materializa seleções lazy, e persiste a recomendação do jogador", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "scorer_pedro",
        confidence_pct: 52,
        player_probs: { scorer_pedro: 52, scorer_arrascaeta: 28 },
        rationale: "Pedro é o melhor palpite de artilheiro.",
        key_factors: ["forma recente", "centroavante titular"],
        minimum_odd: 2.1,
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "anytime_scorer",
    });

    // Pediu bet_92 ao provider de odds.
    expect(oddsGetOddsForSport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ markets: ["bet_92"] }),
    );
    // Materializou seleções lazy com o NOME no label.
    expect(ensureScorerSelections).toHaveBeenCalledWith("mkt-scorer", [
      { key: "scorer_pedro", label: "Pedro" },
      { key: "scorer_arrascaeta", label: "Arrascaeta" },
    ]);
    // NÃO tocou resolveMarketCatalog (que assere zero-seleção).
    expect(resolveMarketCatalog).not.toHaveBeenCalled();

    // Carrier devolve label por seleção.
    expect(result.marketKey).toBe("anytime_scorer");
    const pedro = result.selections.find((s) => s.key === "scorer_pedro");
    expect(pedro?.label).toBe("Pedro");
    expect(pedro?.modelProbPct).toBe(52);
    expect(pedro?.odd).toBe(2.5);

    // A prediction row persistida: recommendation = key do jogador, selectionId
    // do upsert, bookmaker do scorerBundle. insertValues[1] = prediction row.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(predictionRow.recommendation).toBe("scorer_pedro");
    expect(predictionRow.selectionId).toBe("sel-pedro");
    expect(predictionRow.bookmaker).toBe("Bet365");
    // edge = modelProb(52) - teto((1/2.5)*100=40) = 12pp.
    expect(Number(predictionRow.edgePct)).toBeCloseTo(12, 5);
  });

  it("PASS quando nenhum jogador bate o piso de edge", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "pass",
        confidence_pct: 41,
        player_probs: { scorer_pedro: 41, scorer_arrascaeta: 22 },
        rationale: "Sem edge confortável; melhor passar.",
        key_factors: ["margem embutida", "incerteza de escalação"],
      }),
    );
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "anytime_scorer",
    });
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.selectionId).toBeNull();
    expect(result.selections).toHaveLength(2);
  });
});
