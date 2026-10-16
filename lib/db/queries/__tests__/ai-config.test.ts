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

  it("row com id desconhecido (não-Claude/lixo) → DEFAULT_MODEL_ID", async () => {
    // Garante que um id inválido nunca chega ao Anthropic como 404 de modelo.
    for (const bad of ["gpt-5-mini", "modelo-qualquer", "claude-", ""]) {
      defaultRows = [{ defaultModelId: bad }];
      await expect(getDefaultModelId()).resolves.toBe(DEFAULT_MODEL_ID);
    }
  });

  it("row com valor null → DEFAULT_MODEL_ID", async () => {
    defaultRows = [{ defaultModelId: null }];
    await expect(getDefaultModelId()).resolves.toBe(DEFAULT_MODEL_ID);
  });

  it("row com id de versão antiga → lida como o 5.5 da mesma família (ADR 0061)", async () => {
    const cases: [string, string][] = [
      ["claude-haiku-4-5", "claude-haiku-5-5"],
      ["claude-3-5-haiku-20241022", "claude-haiku-5-5"],
      ["claude-sonnet-4-5-20250929", "claude-sonnet-5-5"],
      ["claude-sonnet-5", "claude-sonnet-5-5"],
      ["claude-opus-3-retired-20240229", "claude-opus-5-5"],
    ];
    for (const [stored, expected] of cases) {
      defaultRows = [{ defaultModelId: stored }];
      await expect(getDefaultModelId()).resolves.toBe(expected);
    }
  });

  it("row com Fable/Mythos (fora do app, ADR 0061) → lida como Opus 5.5", async () => {
    for (const stored of ["claude-fable-5-1", "claude-mythos-1"]) {
      defaultRows = [{ defaultModelId: stored }];
      await expect(getDefaultModelId()).resolves.toBe("claude-opus-5-5");
    }
  });

  it("row com id atual do registry → retorna o id persistido como-está", async () => {
    defaultRows = [{ defaultModelId: "claude-haiku-5-5" }];
    await expect(getDefaultModelId()).resolves.toBe("claude-haiku-5-5");
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

  it("row válida → valores persistidos; a coluna temperature legada é ignorada (ADR 0061)", async () => {
    defaultRows = [{ maxTokens: 8000, effort: "low", temperature: "0.50" }];
    await expect(getGenerationParams()).resolves.toEqual({
      maxTokens: 8000,
      effort: "low",
    });
  });

  it("cada campo inválido cai no default individualmente", async () => {
    defaultRows = [{ maxTokens: 999999, effort: "ultra", temperature: "9.9" }];
    await expect(getGenerationParams()).resolves.toEqual(
      GENERATION_PARAM_DEFAULTS,
    );
  });
});
