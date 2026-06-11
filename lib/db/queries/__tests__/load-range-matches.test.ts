import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbMatch } from "@/lib/db/queries/matches";

vi.mock("@/lib/sync/sync-upcoming-fixtures", () => ({
  ensureUpcomingFixturesSynced: vi.fn(),
}));
vi.mock("@/lib/db/queries/matches", () => ({
  getMatchesInRange: vi.fn(),
}));

import { loadRangeMatches } from "@/lib/db/queries/load-range-matches";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";
import { getMatchesInRange } from "@/lib/db/queries/matches";

const mockSync = vi.mocked(ensureUpcomingFixturesSynced);
const mockQuery = vi.mocked(getMatchesInRange);

const QUERY: Parameters<typeof getMatchesInRange>[0] = {
  from: new Date("2026-06-01"),
  to: new Date("2026-06-30"),
  league: "world_cup",
  statuses: ["scheduled"],
  order: "asc",
  limit: 200,
};

// Linha mínima só pra distinguir array vazio de não-vazio nos asserts.
const ROW = { id: "m1" } as unknown as DbMatch;

beforeEach(() => {
  mockSync.mockReset();
  mockQuery.mockReset();
});

describe("loadRangeMatches", () => {
  it("#124: dispara o sync MESMO com DB não-vazio (o guard length===0 não suprime mais)", async () => {
    mockSync.mockResolvedValue();
    mockQuery.mockResolvedValue([ROW]);

    const result = await loadRangeMatches(QUERY);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(QUERY);
    expect(result).toEqual([ROW]);
  });

  it("roda a query e retorna o resultado mesmo quando o DB está vazio", async () => {
    mockSync.mockResolvedValue();
    mockQuery.mockResolvedValue([]);

    const result = await loadRangeMatches(QUERY);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(QUERY);
    expect(result).toEqual([]);
  });

  it("engole erro do sync e ainda roda a query (página não dá 500)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("provider down"));
    mockQuery.mockResolvedValue([ROW]);

    const result = await loadRangeMatches(QUERY);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(QUERY);
    expect(result).toEqual([ROW]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
