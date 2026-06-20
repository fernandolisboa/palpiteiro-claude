import { beforeEach, describe, expect, it, vi } from "vitest";

// getEnableFidelityValidation (#380) drives the read via db.select().from().where().
// limit(); we stub that chain so the resolved row is configurable per test. No real
// Postgres is touched. Mirrors ai-config-best-bet.test.ts — mas o default é ON (true).
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

import { getEnableFidelityValidation } from "@/lib/db/queries/ai-config";

beforeEach(() => {
  rows = [];
});

describe("getEnableFidelityValidation — feature-flag #380 (default ON)", () => {
  it("no row (DB vazio/fresco) → true (doubly-safe: coluna default + ?? true)", async () => {
    rows = [];
    await expect(getEnableFidelityValidation()).resolves.toBe(true);
  });

  it("row enabled=true → true", async () => {
    rows = [{ enabled: true }];
    await expect(getEnableFidelityValidation()).resolves.toBe(true);
  });

  it("row enabled=false → false (kill-switch data-driven, sem deploy)", async () => {
    rows = [{ enabled: false }];
    await expect(getEnableFidelityValidation()).resolves.toBe(false);
  });
});
