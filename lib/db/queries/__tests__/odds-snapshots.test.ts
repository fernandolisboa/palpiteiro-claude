import { beforeEach, describe, expect, it, vi } from "vitest";

import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";

// getLatestOddsSnapshot drives the read via
// db.select().from().where().orderBy().limit(); we stub that chain so the
// resolved row is configurable per test. No real Postgres is touched.
let latestRows: unknown[] = [];
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(latestRows)),
        })),
      })),
    })),
  }));
  return { db: { select } };
});

import { getLatestFreshOddsSnapshot } from "@/lib/db/queries/odds-snapshots";

const NOW = new Date("2026-06-08T12:00:00.000Z");

function snapshotAt(capturedAt: Date) {
  return {
    id: "snap-1",
    matchId: "m-1",
    bookmaker: "Pinnacle",
    market: "over_under_2_5" as const,
    line: "2.5",
    overOdd: "1.900",
    underOdd: "1.950",
    overroundPct: "3.50",
    capturedAt,
  };
}

beforeEach(() => {
  latestRows = [];
});

describe("getLatestFreshOddsSnapshot — TTL boundary comparator", () => {
  it("no snapshot → null", async () => {
    latestRows = [];
    await expect(getLatestFreshOddsSnapshot("m-1", NOW)).resolves.toBeNull();
  });

  it("fresh snapshot (age < TTL) → returned", async () => {
    const row = snapshotAt(new Date(NOW.getTime() - 29 * 60 * 1000));
    latestRows = [row];
    await expect(getLatestFreshOddsSnapshot("m-1", NOW)).resolves.toBe(row);
  });

  it("stale snapshot (age >= TTL) → null (falls back upstream)", async () => {
    latestRows = [snapshotAt(new Date(NOW.getTime() - 31 * 60 * 1000))];
    await expect(getLatestFreshOddsSnapshot("m-1", NOW)).resolves.toBeNull();
  });

  it("boundary: age == TTL is stale (comparator is strict <)", async () => {
    latestRows = [snapshotAt(new Date(NOW.getTime() - ODDS_SNAPSHOT_FRESHNESS_MS))];
    await expect(getLatestFreshOddsSnapshot("m-1", NOW)).resolves.toBeNull();
  });

  it("boundary: age == TTL - 1ms is fresh", async () => {
    const row = snapshotAt(
      new Date(NOW.getTime() - (ODDS_SNAPSHOT_FRESHNESS_MS - 1)),
    );
    latestRows = [row];
    await expect(getLatestFreshOddsSnapshot("m-1", NOW)).resolves.toBe(row);
  });
});
