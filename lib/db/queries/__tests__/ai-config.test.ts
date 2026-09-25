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

import {
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";
import { GENERATION_PARAM_DEFAULTS } from "@/lib/ai/generation-params";

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

  it("row com id válido mas admin-only (Fable 5.1, #524) → DEFAULT_MODEL_ID", async () => {
    // O default vale pra todos: um usuário comum nunca roda um modelo que não pode escolher.
    defaultRows = [{ defaultModelId: "claude-fable-5-1" }];
    await expect(getDefaultModelId()).resolves.toBe(DEFAULT_MODEL_ID);
  });

  it("row com id userSelectable adaptive (Opus 5.5) → retorna o id persistido", async () => {
    defaultRows = [{ defaultModelId: "claude-opus-5-5" }];
    await expect(getDefaultModelId()).resolves.toBe("claude-opus-5-5");
  });
});

describe("getGenerationParams — fallback POR CAMPO (ADR 0008 emenda 2)", () => {
  it("no row (DB vazio) → defaults", async () => {
    defaultRows = [];
    await expect(getGenerationParams()).resolves.toEqual(
      GENERATION_PARAM_DEFAULTS,
    );
  });

  it("row válida → valores persistidos (temperature numeric string → number)", async () => {
    defaultRows = [{ maxTokens: 8000, effort: "low", temperature: "0.50" }];
    await expect(getGenerationParams()).resolves.toEqual({
      maxTokens: 8000,
      effort: "low",
      temperature: 0.5,
    });
  });

  it("cada campo inválido cai no default individualmente", async () => {
    defaultRows = [{ maxTokens: 999999, effort: "ultra", temperature: "9.9" }];
    await expect(getGenerationParams()).resolves.toEqual(
      GENERATION_PARAM_DEFAULTS,
    );
  });
});
