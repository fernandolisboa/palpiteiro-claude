import { describe, expect, it } from "vitest";

import { computeDashboardKpis, type DashboardRow } from "@/lib/dashboard/kpis";
import type { DashboardDetail } from "@/lib/db/queries/dashboard";
import {
  toDashboardKpiView,
  toPredictionDetailView,
  toPredictionRowView,
} from "@/lib/view/dashboard";

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    predictionId: "p1",
    recommendation: "over",
    market: "over_under_2_5",
    league: "world_cup",
    homeTeam: "South Korea",
    awayTeam: "Czech Republic",
    stakeUnits: "1.00",
    oddAtRecommendation: "1.920",
    edgePct: "7.30",
    confidencePct: "58.00",
    createdAt: new Date("2026-06-08T12:00:00Z"),
    result: null,
    profitUnits: null,
    settledAt: null,
    ...overrides,
  };
}

describe("toPredictionRowView", () => {
  it("parses numeric strings and maps a settled win", () => {
    const v = toPredictionRowView(
      row({ result: "won", profitUnits: "1.85" }),
    );
    expect(v.rec).toBe("OVER");
    expect(v.odd).toBe("1.92");
    expect(v.edge).toBe("+7.3");
    expect(v.confidence).toBe("58%");
    expect(v.status).toBe("won");
    expect(v.profit).toBe("+1.85 u");
  });

  it("renders a negative profit and a pending row", () => {
    expect(toPredictionRowView(row({ result: "lost", profitUnits: "-1.00" })).profit).toBe(
      "-1.00 u",
    );
    const pending = toPredictionRowView(row());
    expect(pending.status).toBe("pending");
    expect(pending.profit).toBeNull();
  });

  it("maps a pass with no entry odd", () => {
    const v = toPredictionRowView(
      row({ recommendation: "pass", oddAtRecommendation: null }),
    );
    expect(v.rec).toBe("PASS");
    expect(v.odd).toBe("—");
  });
});

describe("toDashboardKpiView", () => {
  it("shows em-dash for null rates and zero profit on empty data", () => {
    const v = toDashboardKpiView(computeDashboardKpis([]));
    expect(v.yieldPct.value).toBe("—");
    expect(v.yieldPct.n).toBe(0);
    expect(v.totalProfit).toBe("+0.00 u");
    expect(v.profitPositive).toBe(true);
  });

  it("carries the sample size and low-sample flag through", () => {
    const v = toDashboardKpiView(
      computeDashboardKpis([
        row({
          result: "won",
          profitUnits: "0.92",
          settledAt: new Date("2026-06-12T20:00:00Z"),
        }),
      ]),
    );
    expect(v.winRate.value).toBe("100%");
    expect(v.winRate.n).toBe(1);
    expect(v.winRate.lowSample).toBe(true);
  });
});

// ─── Drill-down + admin gate on raw payloads ─────────────────────────────────

const SYSTEM_PROMPT_MARKER = "SECRET SYSTEM PROMPT";

function makeDetail(overrides: Partial<DashboardDetail> = {}): DashboardDetail {
  const match: DashboardDetail["match"] = {
    id: "m1",
    externalId: "ext-1",
    league: "world_cup",
    homeTeam: "South Korea",
    awayTeam: "Czech Republic",
    kickoffAt: new Date("2026-06-12T02:00:00Z"),
    status: "finished",
    homeScore: 2,
    awayScore: 1,
    updatedAt: new Date("2026-06-12T05:00:00Z"),
  };
  const prediction: DashboardDetail["prediction"] = {
    id: "p1",
    matchId: "m1",
    userId: "u1",
    aiCallId: "a1",
    market: "over_under_2_5",
    recommendation: "over",
    confidencePct: "58.00",
    rationale: "razão",
    keyFactors: ["f1", "f2"],
    minimumOdd: "1.960",
    oddAtRecommendation: "1.920",
    bookmaker: "BetX",
    impliedProbPct: "42.89",
    edgePct: "7.30",
    overOddAtPrediction: "1.920",
    underOddAtPrediction: "1.950",
    stakeUnits: "2.00",
    modelVersion: "claude-sonnet-4-5-20250929",
    promptVersion: "over_under_v1.2",
    createdAt: new Date("2026-06-08T01:00:00Z"),
  };
  const aiCall: DashboardDetail["aiCall"] = {
    id: "a1",
    userId: "u1",
    matchId: "m1",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    promptVersion: "over_under_v1.2",
    inputPayload: { system: SYSTEM_PROMPT_MARKER },
    outputPayload: { recommendation: "over" },
    inputTokens: 2345,
    outputTokens: 447,
    latencyMs: 9427,
    costUsd: "0.013740",
    status: "ok",
    errorMessage: null,
    createdAt: new Date("2026-06-08T01:00:09Z"),
  };
  const outcome: DashboardDetail["outcome"] = {
    id: "o1",
    predictionId: "p1",
    totalGoals: 3,
    result: "won",
    profitUnits: "1.84",
    overrideByUserId: null,
    settledAt: new Date("2026-06-12T05:00:00Z"),
  };
  return { prediction, match, outcome, aiCall, ...overrides };
}

describe("toPredictionDetailView", () => {
  it("hides raw payloads (system prompt) from non-admins", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
    });
    expect(v.rawPayloads).toBeNull();
    // ...but the structured view + ai-call meta are still visible to the owner
    expect(v.aiCall?.inputTokens).toBe(2345);
    expect(v.aiCall?.outputTokens).toBe(447);
    expect(v.aiCall?.costUsd).toBe("$0.014");
  });

  it("exposes raw payloads only when includeRawPayloads is true (admin)", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: true,
    });
    expect(v.rawPayloads).not.toBeNull();
    expect(v.rawPayloads?.input).toContain(SYSTEM_PROMPT_MARKER);
  });

  it("parses numeric stake/profit at the view boundary", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
    });
    expect(v.prediction.stake).toBe("2.00 u");
    expect(v.outcome?.profit).toBe("+1.84 u");
    expect(v.match.score).toBe("2-1");
  });

  it("maps a still-pending prediction", () => {
    const v = toPredictionDetailView(makeDetail({ outcome: null }), {
      includeRawPayloads: true,
    });
    expect(v.outcome).toBeNull();
  });

  it("shows the real bookmaker on a pass prediction (frozen pair era, ADR 0012)", () => {
    // Pass novas persistem bookmaker = fonte das odds analisadas — mudança
    // aceita da #104; pass históricas (bookmaker null) seguem em "—".
    const base = makeDetail({ outcome: null });
    const v = toPredictionDetailView(
      {
        ...base,
        prediction: {
          ...base.prediction,
          recommendation: "pass",
          minimumOdd: null,
          oddAtRecommendation: null,
          impliedProbPct: null,
          edgePct: null,
          bookmaker: "BetX",
        },
      },
      { includeRawPayloads: false },
    );
    expect(v.prediction.rec).toBe("PASS");
    expect(v.prediction.bookmaker).toBe("BetX");
    expect(v.prediction.odd).toBe("—");

    const legacy = toPredictionDetailView(
      {
        ...base,
        prediction: {
          ...base.prediction,
          recommendation: "pass",
          minimumOdd: null,
          oddAtRecommendation: null,
          impliedProbPct: null,
          edgePct: null,
          bookmaker: null,
          overOddAtPrediction: null,
          underOddAtPrediction: null,
        },
      },
      { includeRawPayloads: false },
    );
    expect(legacy.prediction.bookmaker).toBe("—");
  });
});
