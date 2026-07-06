import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedLineup,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// ─── Module mocks (mirrors predict.match-result.test.ts; no real DB/Anthropic/HTTP) ──

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "world_cup" as SupportedLeague,
  homeTeam: "Germany",
  awayTeam: "Curaçao",
  kickoffAt: new Date("2026-06-14T17:00:00.000Z"),
  status: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
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
      supportedLeagues: new Set<SupportedLeague>(["world_cup"]),
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

const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...args: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...args),
}));

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

import { doubleChanceCartridge } from "@/lib/ai/markets/double_chance";
import { DOUBLE_CHANCE } from "@/lib/odds/market-descriptor";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { predict } from "@/lib/ai/predict";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REF: FixtureRef = {
  league: "world_cup",
  kickoffAt: matchRow.kickoffAt.toISOString(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
};

const FIXTURE: NormalizedFixture = {
  id: `world_cup:${REF.kickoffAt}:${REF.homeTeam}:${REF.awayTeam}`,
  league: "world_cup",
  kickoffAt: REF.kickoffAt,
  kickoffTimestampMs: matchRow.kickoffAt.getTime(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  status: "scheduled",
  score: { home: null, away: null },
  venue: "Allianz Arena",
};

const STANDINGS: NormalizedStanding = {
  league: "world_cup",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: matchRow.homeTeam,
          played: 3,
          won: 2,
          draw: 1,
          lost: 0,
          goalsFor: 7,
          goalsAgainst: 2,
          points: 7,
        },
        {
          position: 2,
          team: matchRow.awayTeam,
          played: 3,
          won: 1,
          draw: 1,
          lost: 1,
          goalsFor: 4,
          goalsAgainst: 5,
          points: 4,
        },
      ],
    },
  ],
};

const LINEUPS: NormalizedLineup | undefined = undefined;

// Odds de dupla chance COERENTES (derivam de um 1X2 ~45/30/25 + margem): cada
// dupla ≤100% após o de-vig Σ=2, então o ImpliedProbabilitiesSchema [0,100] aceita.
const HD_ODD = "1.270"; // casa ou empate (1X)
const AD_ODD = "1.730"; // empate ou fora (X2)
const HA_ODD = "1.360"; // casa ou fora (12)

// Snapshot N-vias fresco (3 duplas) — odds são STRINGS (numeric → string Drizzle).
function freshSnapshotDC() {
  return {
    bookmaker: "Pinnacle",
    capturedAt: new Date(),
    overroundPct: "5.00",
    selections: [
      { key: "home_or_draw", odd: HD_ODD },
      { key: "away_or_draw", odd: AD_ODD },
      { key: "home_or_away", odd: HA_ODD },
    ],
  };
}

function anthropicMessage(input: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "tool_use", id: "tu-1", name: "submit_prediction", input },
    ],
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

// Probs HONESTAS de par (somam ~200). prob_home_or_draw bem acima da implícita
// de-vigada → edge claro na dupla 1X.
const HD_OUTPUT = {
  recommendation: "home_or_draw",
  confidence_pct: 84,
  prob_home_or_draw: 84,
  prob_away_or_draw: 58,
  prob_home_or_away: 70,
  rationale: "O mandante dificilmente perde este jogo em casa.",
  key_factors: ["mando de campo", "forma recente superior"],
  minimum_odd: 1.2,
};

function catalogDC() {
  return {
    marketId: "mkt-dc",
    idByKey: new Map([
      ["home_or_draw", "sel-hd"],
      ["away_or_draw", "sel-ad"],
      ["home_or_away", "sel-ha"],
    ]),
    keyById: new Map([
      ["sel-hd", "home_or_draw"],
      ["sel-ad", "away_or_draw"],
      ["sel-ha", "home_or_away"],
    ]),
  };
}

function setHappyPath() {
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLineups.mockResolvedValue(LINEUPS);
  getOddsForSport.mockResolvedValue([]); // additional NUNCA batcheia
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(freshSnapshotDC());
  resolveMarketCatalog.mockResolvedValue(catalogDC());
  getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  getPreferredModelId.mockResolvedValue(null);
  anthropicCreate.mockResolvedValue(anthropicMessage(HD_OUTPUT));
}

beforeEach(() => {
  // #231: predict tem backstop hasKey() (client mockado → só a PRESENÇA importa).
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // #385: gate de predict() exige kickoff > Date.now(); congela ANTES do kickoff.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-11T00:00:00.000Z"));
  setHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

// implícita de-vigada de uma dupla, lendo o impliedSumTarget DECLARADO no
// descriptor (não um literal): a asserção casa produção × contrato do descriptor.
function impliedPctOfDC(
  hd: number,
  ad: number,
  ha: number,
  side: "hd" | "ad" | "ha",
) {
  const { probs } = computeMarketImpliedProbabilities([hd, ad, ha]);
  const idx = side === "hd" ? 0 : side === "ad" ? 1 : 2;
  return probs[idx] * 100 * (DOUBLE_CHANCE.impliedSumTarget ?? 1);
}

describe("predict(double_chance) — N=3 happy path pelo caminho additional", () => {
  it("retorna o carrier N-vias (3 duplas) com model probs honestas + odds", async () => {
    const spy = vi.spyOn(doubleChanceCartridge, "buildPredictionInput");
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });

    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    expect(result.marketKey).toBe("double_chance");
    expect(result.selections).toEqual([
      { key: "home_or_draw", modelProbPct: 84, odd: 1.27 },
      { key: "away_or_draw", modelProbPct: 58, odd: 1.73 },
      { key: "home_or_away", modelProbPct: 70, odd: 1.36 },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    // additional NUNCA batcheia (quota): getOddsForSport não é chamado.
    expect(getOddsForSport).not.toHaveBeenCalled();
  });

  it("ai_calls grava promptVersion double_chance_v1", async () => {
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });
    const aiCallRow = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(aiCallRow.promptVersion).toBe("double_chance_v1");
  });

  it("legacy-write pulado: market/over-under cols NULL; marketId/selectionId set; sem linha", async () => {
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.marketParams).toBeNull();
    expect(predictionRow.marketId).toBe("mkt-dc");
    expect(predictionRow.selectionId).toBe("sel-hd");
    expect(predictionRow.recommendation).toBe("home_or_draw");
  });

  it("edge persistido usa a implícita de-vigada Σ=2 (não Σ=1) — casa com a grade", async () => {
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedHd = impliedPctOfDC(1.27, 1.73, 1.36, "hd");
    expect(predictionRow.impliedProbPct).toBe(impliedHd.toFixed(2));
    // edge = prob_home_or_draw(84) − implícita de-vigada Σ=2 (~75%).
    expect(predictionRow.edgePct).toBe((84 - impliedHd).toFixed(2));
    expect(predictionRow.oddAtRecommendation).toBe(HD_ODD);
  });

  it("PSO carrega model_prob_pct honesto por dupla (somam ~200)", async () => {
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });
    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      selectionId: string;
      odd: string;
      modelProbPct: string | null;
    }>;
    expect(psoRows).toHaveLength(3);
    const byId = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.modelProbPct]),
    );
    expect(byId["sel-hd"]).toBe("84.00");
    expect(byId["sel-ad"]).toBe("58.00");
    expect(byId["sel-ha"]).toBe("70.00");
  });
});

describe("predict(double_chance) — pass case", () => {
  it("pass: selectionId null, sem edge, PSO ainda grava as 3 probs", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "pass",
        confidence_pct: 80,
        prob_home_or_draw: 80,
        prob_away_or_draw: 62,
        prob_home_or_away: 58,
        rationale: "Odds baixas e mercado eficiente; nenhuma dupla com edge.",
        key_factors: ["favoritismo precificado", "edge fino"],
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.selectionId).toBeNull();
    expect(predictionRow.oddAtRecommendation).toBeNull();
    expect(predictionRow.impliedProbPct).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(result.selections.map((s) => s.modelProbPct)).toEqual([80, 62, 58]);
  });
});

describe("predict(double_chance) — book enviesado: implícita de-vig >100 NÃO derruba a predição", () => {
  it("favorito extremo (de-vig Σ=2 da dupla 1X >100) persiste em vez de lançar BuildInputError", async () => {
    // odds INCOERENTES mas válidas (todas >1): a de-vig Σ=2 da dupla 1X passa de
    // 100% (raw_HD > raw_AD+raw_HA). Antes do max(200), o ImpliedProbabilitiesSchema
    // [0,100] rejeitava → falha opaca. Agora flui e o edge fica fortemente negativo.
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue({
      bookmaker: "Pinnacle",
      capturedAt: new Date(),
      overroundPct: "10.00",
      selections: [
        { key: "home_or_draw", odd: "1.020" },
        { key: "away_or_draw", odd: "15.000" },
        { key: "home_or_away", odd: "15.000" },
      ],
    });
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "home_or_draw",
        confidence_pct: 95,
        prob_home_or_draw: 95,
        prob_away_or_draw: 10,
        prob_home_or_away: 95,
        rationale: "Favorito extremo cobre casa ou empate com folga.",
        key_factors: ["favorito extremo", "empate improvável"],
        minimum_odd: 1.01,
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "double_chance",
    });

    // O pipeline RESOLVE (não lança): a de-vig Σ=2 >100 fluiu pelo
    // ImpliedProbabilitiesSchema do buildPredictionInput sem o clamp antigo [0,100]
    // rejeitar — a garantia central deste teste, provada pelo predict() não lançar.
    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    const impliedHd = impliedPctOfDC(1.02, 15, 15, "hd");
    expect(impliedHd).toBeGreaterThan(100); // o clamp antigo [0,100] teria rejeitado

    // GATE DE EDGE (ADR 0038): implícita >100 → edge = 95 − (>100) fortemente NEGATIVO
    // (< piso) → a rec é rebaixada pra pass GENUÍNO. É o comportamento certo (edge
    // negativo não é aposta); as colunas de lado-recomendado ficam null.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.impliedProbPct).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.selectionId).toBeNull();
  });
});
