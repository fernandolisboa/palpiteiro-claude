import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";

// getDefaultModelId drives the read via db.select().from().where().limit(); we
// stub that chain so the resolved row is configurable per test. No real Postgres
// is touched. Mirrors lib/db/queries/__tests__/odds-snapshots.test.ts.
let defaultRows: unknown[] = [];
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(defaultRows)),
      })),
    })),
  }));
  return { db: { select } };
});

import { getDefaultModelId } from "@/lib/db/queries/ai-config";

beforeEach(() => {
  defaultRows = [];
});

describe("getDefaultModelId — registry-validated fallback (ADR 0008)", () => {
  it("no row (DB vazio) → DEFAULT_MODEL_ID", async () => {
    defaultRows = [];
    await expect(getDefaultModelId()).resolves.toBe(DEFAULT_MODEL_ID);
  });

  it("row com id fora do registry (stale/inválido) → DEFAULT_MODEL_ID", async () => {
    // Garante que um id obsoleto nunca chega ao Anthropic como 404 de modelo.
    defaultRows = [{ defaultModelId: "claude-opus-3-retired-20240229" }];
    await expect(getDefaultModelId()).resolves.toBe(DEFAULT_MODEL_ID);
  });

  it("row com id válido → retorna o id persistido como-está", async () => {
    defaultRows = [{ defaultModelId: "claude-sonnet-4-5-20250929" }];
    await expect(getDefaultModelId()).resolves.toBe(
      "claude-sonnet-4-5-20250929",
    );
  });
});
