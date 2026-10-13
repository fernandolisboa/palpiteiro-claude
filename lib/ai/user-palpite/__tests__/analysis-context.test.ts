import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A extração é a fronteira paga (Haiku pelo seam AIProvider): mockada.
const extractPalpiteClaims = vi.fn();
vi.mock("@/lib/ai/user-palpite/extract", () => ({
  extractPalpiteClaims: (...args: unknown[]) => extractPalpiteClaims(...args),
}));

import {
  CONTEXT_EXTRACT_CAP_MS,
  startAnalysisContextExtraction,
} from "@/lib/ai/user-palpite/analysis-context";

const TEXT = "O Flamengo está sem o Pedro Guilherme, que se machucou.";
const OK = {
  ok: true,
  claims: [{ team: "home", topic: "absence", text: "x", role: "attack" }],
  warnings: [],
  aiCallId: "ac-1",
};

function start(fanOutDeadline = Date.now() + 120_000) {
  return startAnalysisContextExtraction({
    text: TEXT,
    teams: { home: "Flamengo", away: "Palmeiras" },
    matchId: "m1",
    userId: "u1",
    fanOutDeadline,
  });
}

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  extractPalpiteClaims.mockReset();
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  info.mockRestore();
});

describe("startAnalysisContextExtraction", () => {
  it("repassa o texto, o prazo com teto de 10 s e o aviso 'do seu contexto'", async () => {
    extractPalpiteClaims.mockResolvedValue(OK);
    await expect(start()).resolves.toEqual(OK);
    expect(extractPalpiteClaims).toHaveBeenCalledWith({
      reason: TEXT,
      teams: { home: "Flamengo", away: "Palmeiras" },
      matchId: "m1",
      userId: "u1",
      deadlineAt: Date.now() + CONTEXT_EXTRACT_CAP_MS,
      subject: "contexto",
    });
  });

  it("prazo do fan-out mais curto que o teto vence", async () => {
    extractPalpiteClaims.mockResolvedValue(OK);
    await start(Date.now() + 4_000);
    expect(extractPalpiteClaims.mock.calls[0][0].deadlineAt).toBe(Date.now() + 4_000);
  });

  it("extração lenta: resolve null no teto, sem esperar a chamada", async () => {
    extractPalpiteClaims.mockReturnValue(new Promise(() => {}));
    const p = start();
    let settled: unknown = "pending";
    void p.then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(CONTEXT_EXTRACT_CAP_MS - 1);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
  });

  it("extração que lança vira ok:false (nunca rejeita)", async () => {
    extractPalpiteClaims.mockRejectedValue(new Error("boom"));
    await expect(start()).resolves.toMatchObject({ ok: false, message: "boom" });
  });

  it("o log não leva o texto", async () => {
    extractPalpiteClaims.mockResolvedValue(OK);
    await start();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("user_context");
    expect(logged).not.toContain("Pedro");
    expect(logged).not.toContain("machucou");
  });
});
