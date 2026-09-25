import { beforeEach, describe, expect, it, vi } from "vitest";

// getAnalysisEngine (#511, ADR 0041 §5). Stub da cadeia do db, como
// ai-config-fidelity.test.ts — nenhum Postgres real. A escrita passa pelo
// setAdminFlag do registry (coberto em admin-flags.pglite.test.ts).
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

import { getAnalysisEngine } from "@/lib/db/queries/ai-config";

beforeEach(() => {
  rows = [];
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
