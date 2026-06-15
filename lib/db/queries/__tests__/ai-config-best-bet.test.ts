import { beforeEach, describe, expect, it, vi } from "vitest";

// getEnableBestBetFanOut drives the read via db.select().from().where().limit();
// we stub that chain so the resolved row is configurable per test. No real
// Postgres is touched. Mirrors lib/db/queries/__tests__/ai-config.test.ts.
let rows: unknown[] = [];
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  }));
  return { db: { select } };
});

import { getEnableBestBetFanOut } from "@/lib/db/queries/ai-config";

beforeEach(() => {
  rows = [];
});

describe("getEnableBestBetFanOut — feature-flag #178 (default OFF)", () => {
  it("no row (DB vazio) → false", async () => {
    rows = [];
    await expect(getEnableBestBetFanOut()).resolves.toBe(false);
  });

  it("row enabled=false → false", async () => {
    rows = [{ enabled: false }];
    await expect(getEnableBestBetFanOut()).resolves.toBe(false);
  });

  it("row enabled=true → true (flip data-driven)", async () => {
    rows = [{ enabled: true }];
    await expect(getEnableBestBetFanOut()).resolves.toBe(true);
  });
});
