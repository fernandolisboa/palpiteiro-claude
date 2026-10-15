import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatest = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestSelectionOddsSnapshotsForMatches: (...args: unknown[]) => getLatest(...args),
}));

import {
  getReferenceOddsForMatch,
  REFERENCE_MAX_AGE_MS,
} from "@/lib/db/queries/reference-odds";

const NOW = new Date("2026-10-15T12:00:00Z");
const OLD = new Date(NOW.getTime() - REFERENCE_MAX_AGE_MS - 60_000);

beforeEach(() => {
  getLatest.mockReset();
  // Só o 1X2 tem captura, e ela é mais velha que o corte do cupom.
  getLatest.mockImplementation(async (_ids: string[], market: string) =>
    market === "match_result"
      ? new Map([
          [
            "m-1",
            {
              bookmaker: "pinnacle",
              capturedAt: OLD,
              selections: [
                { key: "home", odd: "2.10" },
                { key: "draw", odd: "3.30" },
                { key: "away", odd: "3.60" },
              ],
            },
          ],
        ])
      : new Map(),
  );
});

describe("getReferenceOddsForMatch", () => {
  it("o cupom (default) descarta captura mais velha que REFERENCE_MAX_AGE_MS", async () => {
    expect((await getReferenceOddsForMatch("m-1", NOW)).size).toBe(0);
  });

  it("maxAgeMs: null (tabela de jogo já começado, #576) devolve a captura velha", async () => {
    const refs = await getReferenceOddsForMatch("m-1", NOW, { maxAgeMs: null });
    expect(refs.get("match_result")).toEqual({
      bookmaker: "pinnacle",
      capturedAt: OLD,
      odds: { home: 2.1, draw: 3.3, away: 3.6 },
    });
  });
});
