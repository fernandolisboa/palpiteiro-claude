import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks: a captura é orquestração. getDescriptor + clv-window ficam REAIS (puros).
vi.mock("@/lib/db/queries/ai-config", () => ({ getEnableClvCapture: vi.fn() }));
vi.mock("@/lib/db/queries/predictions", () => ({
  getNonPassPredictionsNearKickoff: vi.fn(),
}));
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: vi.fn(),
}));
vi.mock("@/lib/providers/odds-api", () => ({ getLastOddsApiQuota: vi.fn() }));

import { getEnableClvCapture } from "@/lib/db/queries/ai-config";
import { getNonPassPredictionsNearKickoff } from "@/lib/db/queries/predictions";
import type { DbMatch } from "@/lib/db/queries/predictions";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { getLastOddsApiQuota } from "@/lib/providers/odds-api";
import { captureClosingLines } from "@/lib/odds/closing-line";

const enable = vi.mocked(getEnableClvCapture);
const candidates = vi.mocked(getNonPassPredictionsNearKickoff);
const ensure = vi.mocked(ensureOddsSnapshotsFresh);
const quota = vi.mocked(getLastOddsApiQuota);

function match(id: string): DbMatch {
  return {
    id,
    externalId: `ext-${id}`,
    league: "world_cup",
    homeTeam: "A",
    awayTeam: "B",
    kickoffAt: new Date("2026-06-15T20:00:00Z"),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    updatedAt: new Date("2026-06-15T18:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  quota.mockReturnValue(null);
});

describe("captureClosingLines — gate da flag (AC: zero captura quando OFF)", () => {
  it("flag OFF → enabled:false, NENHUM fetch (zero gasto de quota)", async () => {
    enable.mockResolvedValue(false);
    const s = await captureClosingLines();
    expect(s.enabled).toBe(false);
    expect(s.consideredMatches).toBe(0);
    expect(candidates).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("captureClosingLines — flag ON", () => {
  beforeEach(() => enable.mockResolvedValue(true));

  it("captura por jogo com descriptor resolvido; conta + surface quota", async () => {
    candidates.mockResolvedValue([
      { match: match("m1"), marketKeys: ["over_under"] },
      { match: match("m2"), marketKeys: ["match_result"] },
    ]);
    ensure.mockResolvedValue(null);
    quota.mockReturnValue({
      monthlyRemaining: 420,
      monthlyUsed: 80,
      monthlyLimit: 500,
      dailyRemaining: null,
      dailyLimit: null,
      perMinuteRemaining: null,
    });

    const s = await captureClosingLines();
    expect(s.enabled).toBe(true);
    expect(s.consideredMatches).toBe(2);
    expect(s.capturedMatches).toBe(2);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(s.quotaMonthlyRemaining).toBe(420);
    expect(s.quotaMonthlyUsed).toBe(80);
  });

  it("marketKey sem descriptor → skippedNoDescriptor, sem fetch", async () => {
    candidates.mockResolvedValue([
      { match: match("m1"), marketKeys: ["nope_unknown"] },
    ]);
    const s = await captureClosingLines();
    expect(s.skippedNoDescriptor).toBe(1);
    expect(s.capturedMatches).toBe(0);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("erro num jogo não derruba o run (conta errors e segue)", async () => {
    candidates.mockResolvedValue([
      { match: match("m1"), marketKeys: ["over_under"] },
      { match: match("m2"), marketKeys: ["over_under"] },
    ]);
    ensure.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(null);
    const s = await captureClosingLines();
    expect(s.errors).toBe(1);
    expect(s.capturedMatches).toBe(1);
    expect(ensure).toHaveBeenCalledTimes(2);
  });
});
