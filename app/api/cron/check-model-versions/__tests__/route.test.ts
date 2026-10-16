import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/model-versions/check", () => ({
  runModelVersionCheck: vi.fn(),
}));

import { GET } from "@/app/api/cron/check-model-versions/route";
import { runModelVersionCheck } from "@/lib/ai/model-versions/check";
import type { ModelVersionsCheckSummary } from "@/lib/ai/model-versions/types";

const runMock = vi.mocked(runModelVersionCheck);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/check-model-versions", { headers });
}

function summary(over: Partial<ModelVersionsCheckSummary> = {}): ModelVersionsCheckSummary {
  return { status: "ok", adopted: [], failed: [], transient: [], pinnedMissing: [], ...over };
}

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/check-model-versions (ADR 0062)", () => {
  it("401 sem CRON_SECRET configurado, sem checagem", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(req("Bearer anything"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("401 com Authorization ausente ou errado", async () => {
    for (const bad of [undefined, "", "Bearer wrong"]) {
      expect((await GET(req(bad))).status).toBe(401);
    }
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 com o resultado (ok, flag desligada, sem chave)", async () => {
    const ok = { status: "ok" as const, summary: summary({ adopted: ["claude-sonnet-5-6"] }) };
    runMock.mockResolvedValue(ok);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, result: ok });

    runMock.mockResolvedValue({ status: "disabled", summary: summary({ status: "disabled" }) });
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
    runMock.mockResolvedValue({ status: "skipped", reason: "no_key" });
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("e-mail que falhou não vira 500", async () => {
    runMock.mockResolvedValue({ status: "ok", summary: summary({ emailError: "resend fora" }) });
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("500 com listagem que falhou ou erro numa família", async () => {
    runMock.mockResolvedValue({
      status: "listing_failed",
      summary: summary({ status: "listing_failed", error: "api fora" }),
    });
    expect((await GET(req("Bearer s3cret"))).status).toBe(500);
    runMock.mockResolvedValue({ status: "ok", summary: summary({ error: "sonnet: boom" }) });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it("500 genérico quando a checagem lança", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "check_model_versions_failed",
    });
    error.mockRestore();
  });
});
