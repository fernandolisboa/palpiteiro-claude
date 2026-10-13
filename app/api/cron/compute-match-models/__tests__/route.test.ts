import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-base/compute-match-models", () => ({
  computeMatchModels: vi.fn(),
}));

import { GET } from "@/app/api/cron/compute-match-models/route";
import {
  computeMatchModels,
  type ComputeMatchModelsSummary,
} from "@/lib/model-base/compute-match-models";

const runMock = vi.mocked(computeMatchModels);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/compute-match-models", { headers });
}

function summary(
  over: Partial<ComputeMatchModelsSummary> = {},
): ComputeMatchModelsSummary {
  return {
    jevEnabled: true,
    jevMissingKey: false,
    leagues: [{ league: "brasileirao_a", matches: 3, error: false }],
    considered: 3,
    inserted: 2,
    unchanged: 1,
    noModel: 0,
    errors: 0,
    jev: {
      queued: 1,
      applied: 1,
      reused: 0,
      failed: 0,
      dataUnavailable: 0,
      skippedDeadline: 0,
      skippedMissingKey: 0,
    },
    ...over,
  };
}

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/compute-match-models", () => {
  it("401 sem secret configurado ou com Authorization errado, sem rodar", async () => {
    for (const bad of [undefined, "", "Bearer wrong"]) {
      expect((await GET(req(bad))).status).toBe(401);
    }
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(req("Bearer anything"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("200 com o resumo em Bearer correto", async () => {
    const s = summary();
    runMock.mockResolvedValue(s);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, summary: s });
  });

  it("JEV que falhou, prazo e chave ausente não são erro: 200", async () => {
    runMock.mockResolvedValue(
      summary({
        jevMissingKey: true,
        jev: {
          queued: 0,
          applied: 0,
          reused: 0,
          failed: 2,
          dataUnavailable: 1,
          skippedDeadline: 3,
          skippedMissingKey: 4,
        },
      }),
    );
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("200 ok:true quando outro run segura o lock", async () => {
    const s = { ...summary({ considered: 0, inserted: 0, unchanged: 0 }), skipped: "locked" as const };
    runMock.mockResolvedValue(s);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      summary: { skipped: "locked" },
    });
  });

  it("500 com o resumo quando houve erro em jogo ou liga", async () => {
    const s = summary({ errors: 1 });
    runMock.mockResolvedValue(s);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, summary: s });
  });

  it("500 quando o run lança", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runMock.mockRejectedValue(new Error("db down"));
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "compute_match_models_failed",
    });
    error.mockRestore();
  });
});
