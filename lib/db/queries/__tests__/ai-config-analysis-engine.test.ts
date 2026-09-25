import { beforeEach, describe, expect, it, vi } from "vitest";

// getAnalysisEngine / setAnalysisEngine (#511, ADR 0041 §5). Stub da cadeia do db,
// como ai-config-fidelity.test.ts — nenhum Postgres real.
let rows: unknown[] = [];
const insertValues = vi.fn();
const onConflictDoUpdate = vi.fn();
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: (v: unknown) => {
      insertValues(v);
      return {
        onConflictDoUpdate: (c: unknown) => {
          onConflictDoUpdate(c);
          return Promise.resolve();
        },
      };
    },
  }));
  return { db: { select, insert } };
});

import {
  getAnalysisEngine,
  setAnalysisEngine,
} from "@/lib/db/queries/ai-config";

beforeEach(() => {
  rows = [];
  insertValues.mockReset();
  onConflictDoUpdate.mockReset();
});

describe("getAnalysisEngine — flag analysis_engine (default 'llm')", () => {
  it("sem row → 'llm'", async () => {
    await expect(getAnalysisEngine()).resolves.toBe("llm");
  });

  it("row 'code_jev' → 'code_jev'", async () => {
    rows = [{ analysisEngine: "code_jev" }];
    await expect(getAnalysisEngine()).resolves.toBe("code_jev");
  });

  it("valor persistido inválido → 'llm'", async () => {
    rows = [{ analysisEngine: "jev_direto" }];
    await expect(getAnalysisEngine()).resolves.toBe("llm");
  });
});

describe("setAnalysisEngine", () => {
  it("upsert em id=1 gravando o motor e quem alterou", async () => {
    await setAnalysisEngine("code_jev", "u1");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        analysisEngine: "code_jev",
        updatedByUserId: "u1",
      })
    );
    const conflict = onConflictDoUpdate.mock.calls[0][0] as {
      set: Record<string, unknown>;
    };
    expect(conflict.set).toMatchObject({
      analysisEngine: "code_jev",
      updatedByUserId: "u1",
    });
  });
});
