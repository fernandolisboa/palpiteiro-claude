import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// predictInPlay (#594, ADR 0060 §8): a leitura ao vivo. Fronteiras mockadas (sem DB,
// Anthropic, Odds API, TypeSafe nem API-Football reais). As chances vêm do modelo em
// jogo REAL (lib/quant/in-play) sobre uma base fixa; o LLM só narra.

const KICKOFF = new Date("2026-05-15T19:00:00.000Z");
const NOW = new Date("2026-05-15T20:10:00.000Z");

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "brasileirao_a" as SupportedLeague,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: KICKOFF,
  status: "live" as "live" | "scheduled" | "finished",
  homeScore: null,
  awayScore: null,
  neutralVenue: false,
  updatedAt: KICKOFF,
};

const inserted: Record<string, unknown>[] = [];
let insertSeq = 0;
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: (rowOrRows: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      inserted.push(...rows);
      const id = `row-${++insertSeq}`;
      return {
        returning: vi.fn(() =>
          Promise.resolve([{ ...rows[0], id, createdAt: NOW }]),
        ),
      };
    },
  }));
  return { db: { select, insert } };
});

// Nenhuma odd depois do apito: qualquer toque nas fronteiras de odds derruba o teste.
const oddsTouched = vi.fn(() => {
  throw new Error("odds provider tocado ao vivo");
});
vi.mock("@/lib/providers/odds", () => ({ getOddsProvider: () => oddsTouched() }));
vi.mock("@/lib/providers/odds-api", () => ({ getOddsForSport: () => oddsTouched() }));
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: () => oddsTouched(),
}));
// Nem os dados de contexto de pré-jogo (forma, h2h, tabela, desfalques, escalação).
const sportsTouched = vi.fn(() => {
  throw new Error("sports-data tocado ao vivo");
});
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: () => sportsTouched(),
}));
const judgeTouched = vi.fn();
vi.mock("@/lib/ai/judgments/provider", () => ({
  createTypeSafeJudgmentProvider: () => {
    judgeTouched();
    throw new Error("JEV tocado ao vivo");
  },
}));

const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketCatalog: (...args: unknown[]) => resolveMarketCatalog(...args),
}));

const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: () => Promise.resolve("claude-sonnet-4-5-20250929"),
  getGenerationParams: () =>
    Promise.resolve({ maxTokens: 16000, effort: "high", temperature: 0.3 }),
}));
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: () => Promise.resolve(null),
}));

// A base do apito, fixa: o modelo em jogo roda de verdade sobre ela.
const resolveInPlaySlipModel = vi.fn();
vi.mock("@/lib/bets/slip-model", () => ({
  resolveInPlaySlipModel: (...args: unknown[]) => resolveInPlaySlipModel(...args),
}));

import { predictInPlay, PredictError } from "@/lib/ai/predict";
import { NARRATOR_VERSION } from "@/lib/ai/markets/_narrator";
import { NARRATOR_LIVE_VERSION } from "@/lib/ai/markets/_narrator/live";
import type { InPlayState } from "@/lib/live/in-play-state";
import { readLiveStamp } from "@/lib/live/stamp";
import { inPlayScoreline } from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const PRE: ModelScoreline = {
  source: "dixon_coles",
  degraded: false,
  lambdaHome: 1.5,
  lambdaAway: 1.1,
  rho: -0.1,
  matrix: scorelineMatrix(1.5, 1.1, { rho: -0.1 }),
};

function state(over: Partial<InPlayState> = {}): InPlayState {
  return {
    matchId: "m-1",
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    fetchedAt: new Date(NOW.getTime() - 20_000),
    ageMs: 20_000,
    ...over,
  };
}

const KEYS: Record<string, string[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  btts: ["yes", "no"],
  over_under: ["over", "under"],
};

function catalogFor(dbKey: string) {
  const keys = KEYS[dbKey];
  return {
    marketId: `mkt-${dbKey}`,
    idByKey: new Map(keys.map((k) => [k, `sel-${dbKey}-${k}`])),
    keyById: new Map(keys.map((k) => [`sel-${dbKey}-${k}`, k])),
  };
}

let narration: Record<string, unknown>;
function anthropicMessage(input: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu-1", name: "submit_narration", input }],
    usage: { input_tokens: 700, output_tokens: 150 },
  };
}

const ALL = ["match_result", "double_chance", "btts", "over_under"];

const args = (over: Partial<Parameters<typeof predictInPlay>[0]> = {}) => ({
  matchId: "m-1",
  userId: "u-1",
  isAdmin: false,
  marketKeys: ALL,
  state: state(),
  now: NOW,
  ...over,
});

const predictionRows = () => inserted.filter((r) => "recommendation" in r);
const aiCallRows = () => inserted.filter((r) => "promptVersion" in r && "provider" in r);
const psoRows = () => inserted.filter((r) => "predictionId" in r);

beforeEach(() => {
  // A rechecagem de fase do predictInPlay usa o relógio de agora (não o `now` da
  // action): o relógio do teste fica no NOW, e um teste o adianta.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  vi.clearAllMocks();
  inserted.length = 0;
  insertSeq = 0;
  matchRow.status = "live";
  resolveMarketCatalog.mockImplementation((dbKey: string) =>
    Promise.resolve(catalogFor(dbKey)),
  );
  resolveInPlaySlipModel.mockImplementation(
    (_m: unknown, s: InPlayState) =>
      Promise.resolve(
        inPlayScoreline(PRE, {
          statusShort: s.statusShort,
          elapsed: s.elapsed,
          extra: s.extra,
          score: s.score!,
          red: s.red,
        }),
      ),
  );
  narration = {
    rationale: "Aos 63', o CR Flamengo vence por 1 × 0 e o tempo joga a favor do mandante.",
    key_factors: ["Placar 1 × 0 aos 63'", "Menos de meia hora pela frente"],
  };
  anthropicCreate.mockImplementation(() => Promise.resolve(anthropicMessage(narration)));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("predictInPlay", () => {
  it("uma chamada paga (narrator_live_v1, logada), 4 predictions pass ao vivo, sem odd", async () => {
    const results = await predictInPlay(args());

    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    const req = anthropicCreate.mock.calls[0][0] as {
      system: unknown;
      messages: { content: unknown }[];
    };
    const userMsg = JSON.stringify(req.messages);
    expect(userMsg).toContain("Momento: aos 63'");
    expect(userMsg).toContain("Placar: CR Flamengo 1 × 0 Fluminense FC");

    const calls = aiCallRows();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      promptVersion: NARRATOR_LIVE_VERSION,
      status: "ok",
      userId: "u-1",
      matchId: "m-1",
    });
    expect(calls[0].promptVersion).not.toBe(NARRATOR_VERSION);

    const preds = predictionRows();
    expect(preds).toHaveLength(4);
    for (const p of preds) {
      expect(p).toMatchObject({
        recommendation: "pass",
        selectionId: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        minimumOdd: null,
        stakeUnits: "1.00",
        promptVersion: NARRATOR_LIVE_VERSION,
        isLive: true,
        modelVersion:
          "claude-sonnet-4-5-20250929;engine=code_jev;lambda=dixon_coles;live=live_model_v1",
      });
      expect(p).not.toHaveProperty("judgments");
      const stamp = readLiveStamp(p.liveState);
      expect(stamp).toMatchObject({
        source: "api_football",
        status: "2H",
        minuteLabel: "63'",
        score: { home: 1, away: 0 },
        recordedAt: NOW.toISOString(),
        inPlay: { liveModelVersion: "live_model_v1" },
      });
    }
    for (const r of psoRows()) {
      expect(r.odd).toBeNull();
      expect(typeof r.modelProbPct).toBe("string");
    }

    // Só o 1X2 é narrado; os outros apontam pra mesma ai_call, com racional templado.
    expect(results.map((r) => [r.marketKey, r.narrated])).toEqual([
      ["match_result", true],
      ["double_chance", false],
      ["btts", false],
      ["over_under", false],
    ]);
    const mr = preds.find((p) => p.marketId === "mkt-match_result")!;
    expect(mr.rationale).toBe(narration.rationale);
    const btts = preds.find((p) => p.marketId === "mkt-btts")!;
    expect(btts.rationale).toContain("Sem odd ao vivo, o app não recomenda aposta.");
    expect(new Set(preds.map((p) => p.aiCallId)).size).toBe(1);

    expect(oddsTouched).not.toHaveBeenCalled();
    expect(sportsTouched).not.toHaveBeenCalled();
    expect(judgeTouched).not.toHaveBeenCalled();
  });

  it("as chances são as do modelo em jogo (soma 100 no 1X2) e o placar decide o que já bateu", async () => {
    const results = await predictInPlay(
      args({ state: state({ score: { home: 2, away: 1 } }) }),
    );
    const byMarket = Object.fromEntries(
      results.map((r) => [
        r.marketKey,
        Object.fromEntries(r.result.selections.map((s) => [s.key, s.modelProbPct])),
      ]),
    );
    const mr = byMarket.match_result;
    expect(mr.home + mr.draw + mr.away).toBeCloseTo(100, 0);
    expect(mr.home).toBeGreaterThan(mr.away);
    // 2–1: over 2,5 e ambas marcam já decididos, exatos.
    expect(byMarket.over_under).toEqual({ over: 100, under: 0 });
    expect(byMarket.btts).toEqual({ yes: 100, no: 0 });
    const ou = predictionRows().find((p) => p.marketId === "mkt-over_under")!;
    expect(ou.confidencePct).toBe("100.00");
    expect(ou.marketParams).toEqual({ line: 2.5 });
  });

  it("intervalo: o momento é 'no intervalo'", async () => {
    await predictInPlay(
      args({ state: state({ statusShort: "HT", elapsed: 45, minuteLabel: "intervalo" }) }),
    );
    expect(JSON.stringify(anthropicCreate.mock.calls[0][0])).toContain(
      "Momento: no intervalo",
    );
  });

  it("narração reprovada na fidelidade → racional templado, ai_call invalid_output", async () => {
    narration = {
      rationale: "Aos 63', aposte no CR Flamengo: 90% de chance.",
      key_factors: ["valor claro", "edge alto"],
    };
    await predictInPlay(args());
    expect(aiCallRows()[0]).toMatchObject({ status: "invalid_output" });
    const mr = predictionRows().find((p) => p.marketId === "mkt-match_result")!;
    expect(mr.rationale).toContain("Sem odd ao vivo, o app não recomenda aposta.");
  });

  it("estado velho (> 2 min), sem placar, ou fase errada → recusa antes de qualquer gasto", async () => {
    const stale = state({
      fetchedAt: new Date(NOW.getTime() - 3 * 60_000),
      ageMs: 180_000,
    });
    await expect(predictInPlay(args({ state: stale }))).rejects.toThrow(
      /not analyzable live/,
    );
    await expect(predictInPlay(args({ state: state({ score: null }) }))).rejects.toThrow(
      PredictError,
    );
    await expect(
      predictInPlay(args({ state: state({ statusShort: "ET", elapsed: 95 }) })),
    ).rejects.toThrow(/not analyzable live/);
    matchRow.status = "finished";
    await expect(predictInPlay(args())).rejects.toThrow(/not analyzable live/);
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("estado bom no `now` da action, velho no relógio de agora → recusa sem gasto", async () => {
    // A action leu o estado (20 s) e chamou com o now dela; até a rechecagem passaram
    // 2,5 min: o estado já tem 2m50s.
    vi.setSystemTime(new Date(NOW.getTime() + 150_000));
    await expect(predictInPlay(args({ now: NOW }))).rejects.toThrow(
      /not analyzable live/,
    );
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("sem modelo em jogo → 'no in-play model', sem gasto", async () => {
    resolveInPlaySlipModel.mockResolvedValue(null);
    await expect(predictInPlay(args())).rejects.toThrow(/no in-play model/);
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("mercados fora da leitura ao vivo são ignorados; nenhum sobrando → recusa", async () => {
    const results = await predictInPlay(args({ marketKeys: ["correct_score", "btts"] }));
    expect(results.map((r) => r.marketKey)).toEqual(["btts"]);
    // Sem 1X2, o 1º mercado é o narrado.
    expect(results[0].narrated).toBe(true);
    await expect(
      predictInPlay(args({ marketKeys: ["correct_score"] })),
    ).rejects.toThrow(/no in-play market/);
  });
});
