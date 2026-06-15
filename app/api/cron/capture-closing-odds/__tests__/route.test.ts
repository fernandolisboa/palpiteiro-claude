import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/odds/closing-line", () => ({
  captureClosingLines: vi.fn(),
}));

import { GET } from "@/app/api/cron/capture-closing-odds/route";
import { captureClosingLines } from "@/lib/odds/closing-line";

const runMock = vi.mocked(captureClosingLines);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/capture-closing-odds", { headers });
}

const SUMMARY = {
  enabled: true,
  consideredMatches: 2,
  capturedMatches: 2,
  skippedNoDescriptor: 0,
  errors: 0,
  quotaMonthlyRemaining: 420,
  quotaMonthlyUsed: 80,
};

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/capture-closing-odds", () => {
  it("401 e loga quando CRON_SECRET não está setado, sem capturar", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("401 sem header de Authorization", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401 em Authorization em branco ou errado", async () => {
    for (const bad of ["", "Bearer wrong"]) {
      runMock.mockReset();
      const res = await GET(req(bad));
      expect(res.status).toBe(401);
      expect(runMock).not.toHaveBeenCalled();
    }
  });

  it("200 com o summary em Bearer correto", async () => {
    runMock.mockResolvedValue(SUMMARY);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, summary: SUMMARY });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("500 e loga quando a captura lança", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "capture_closing_odds_failed",
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
