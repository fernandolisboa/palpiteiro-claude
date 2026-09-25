import { beforeEach, describe, expect, it, vi } from "vitest";

const getAnalysisEngine = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getAnalysisEngine: () => getAnalysisEngine(),
}));

import {
  readAnalysisEngine,
  resetAnalysisEngineMemo,
} from "@/lib/ai/engine/analysis-engine-flag";

beforeEach(() => {
  getAnalysisEngine.mockReset();
  resetAnalysisEngineMemo();
});

describe("readAnalysisEngine (memo 60s)", () => {
  it("lê uma vez e reusa por 60s; depois relê (flip do admin vale rápido)", async () => {
    getAnalysisEngine.mockResolvedValueOnce("code_jev");
    expect(await readAnalysisEngine(0)).toBe("code_jev");
    expect(await readAnalysisEngine(59_999)).toBe("code_jev");
    expect(getAnalysisEngine).toHaveBeenCalledTimes(1);

    getAnalysisEngine.mockResolvedValueOnce("llm");
    expect(await readAnalysisEngine(60_000)).toBe("llm");
    expect(getAnalysisEngine).toHaveBeenCalledTimes(2);
  });

  it("erro de leitura → 'llm', sem memoizar a falha", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    getAnalysisEngine.mockRejectedValueOnce(new Error("db down"));
    expect(await readAnalysisEngine(0)).toBe("llm");
    getAnalysisEngine.mockResolvedValueOnce("code_jev");
    expect(await readAnalysisEngine(1)).toBe("code_jev");
    expect(getAnalysisEngine).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it("reset zera o memo", async () => {
    getAnalysisEngine.mockResolvedValue("code_jev");
    await readAnalysisEngine(0);
    resetAnalysisEngineMemo();
    await readAnalysisEngine(1);
    expect(getAnalysisEngine).toHaveBeenCalledTimes(2);
  });
});
