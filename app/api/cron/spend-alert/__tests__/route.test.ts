import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/spend-alert", () => ({
  runSpendAlert: vi.fn(),
}));

import { GET } from "@/app/api/cron/spend-alert/route";
import { runSpendAlert } from "@/lib/notifications/spend-alert";

const runMock = vi.mocked(runSpendAlert);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/spend-alert", { headers });
}

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/spend-alert", () => {
  it("returns 401 and logs when CRON_SECRET is unset, without running the alert", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns 401 on blank or wrong Authorization", async () => {
    for (const bad of ["", "Bearer wrong"]) {
      runMock.mockReset();
      const res = await GET(req(bad));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(runMock).not.toHaveBeenCalled();
    }
  });

  it("returns 200 with the spread summary on correct Bearer auth", async () => {
    runMock.mockResolvedValue({ sent: true, spendUsd: 25, thresholdUsd: 10 });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sent: true,
      spendUsd: 25,
      thresholdUsd: 10,
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("returns 500 and logs when the alert throws", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "spend_alert_failed",
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
