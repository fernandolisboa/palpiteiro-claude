import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatest = vi.fn();
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshot: (...args: unknown[]) => getLatest(...args),
}));

// Fronteiras de odds: a leitura do modelo NUNCA pode tocar nelas (a base não expõe
// valor, e cada refresh custa quota da The Odds API).
const ensureOddsSnapshotsFresh = vi.fn();
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: (...args: unknown[]) =>
    ensureOddsSnapshotsFresh(...args),
}));
const getOddsProvider = vi.fn();
vi.mock("@/lib/providers/odds", () => ({
  getOddsProvider: (...args: unknown[]) => getOddsProvider(...args),
}));
const getLatestSelectionOddsSnapshotsForMatches = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestSelectionOddsSnapshotsForMatches: (...args: unknown[]) =>
    getLatestSelectionOddsSnapshotsForMatches(...args),
}));

import { buildMatchModelSnapshot } from "@/lib/model-base/build-snapshot";
import { loadMatchModelReading } from "@/lib/model-base/reading";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const NOW = new Date("2026-05-14T12:00:00Z");

function snapshot(): MatchModelSnapshot {
  const row = buildMatchModelSnapshot({
    matchId: "m-1",
    scoreline: {
      source: "dixon_coles",
      degraded: false,
      lambdaHome: 1.5,
      lambdaAway: 1.1,
      rho: -0.08,
      matrix: scorelineMatrix(1.5, 1.1, { rho: -0.08 }),
    },
    neutral: false,
    jev: null,
  });
  return {
    ...row,
    id: "snap-1",
    computedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    checkedAt: new Date(NOW.getTime() - 2 * 3_600_000),
  } as MatchModelSnapshot;
}

beforeEach(() => {
  getLatest.mockReset();
  ensureOddsSnapshotsFresh.mockReset();
  getOddsProvider.mockReset();
  getLatestSelectionOddsSnapshotsForMatches.mockReset();
});

describe("loadMatchModelReading", () => {
  it("lê só a base: probabilidades de todos os mercados, sem tocar em odds", async () => {
    getLatest.mockResolvedValue(snapshot());
    const view = await loadMatchModelReading({ matchId: "m-1", now: NOW });

    expect(getLatest).toHaveBeenCalledWith("m-1");
    expect(view?.markets.map((m) => m.key)).toEqual([
      "match_result",
      "double_chance",
      "btts",
      "over_under:1.5",
      "over_under:2.5",
      "over_under:3.5",
    ]);
    expect(view?.computedAgo).toBe("2h");
    expect(ensureOddsSnapshotsFresh).not.toHaveBeenCalled();
    expect(getOddsProvider).not.toHaveBeenCalled();
    expect(getLatestSelectionOddsSnapshotsForMatches).not.toHaveBeenCalled();
  });

  it("sem base → null", async () => {
    getLatest.mockResolvedValue(null);
    expect(await loadMatchModelReading({ matchId: "m-1", now: NOW })).toBeNull();
  });

  it("erro na leitura da base → null (com log), nunca rejeita", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    getLatest.mockRejectedValue(new Error("db down"));
    await expect(
      loadMatchModelReading({ matchId: "m-1", now: NOW }),
    ).resolves.toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
