import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ratings/refit-team-ratings", () => ({
  refitTeamRatings: vi.fn(),
}));

import { GET } from "@/app/api/cron/refit-team-ratings/route";
import { refitTeamRatings } from "@/lib/ratings/refit-team-ratings";

const runMock = vi.mocked(refitTeamRatings);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/refit-team-ratings", { headers });
}

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/refit-team-ratings", () => {
  it("401 sem CRON_SECRET configurado, sem refit", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("401 com Authorization ausente ou errado", async () => {
    for (const bad of [undefined, "", "Bearer wrong"]) {
      const res = await GET(req(bad));
      expect(res.status).toBe(401);
    }
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 com o resultado por liga em Bearer correto", async () => {
    const results = [
      {
        league: "brasileirao_a" as const,
        status: "fitted" as const,
        matchCount: 900,
        teamCount: 26,
        seasons: [2026, 2025, 2024],
        failedSeasons: [],
      },
    ];
    runMock.mockResolvedValue(results);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, results });
  });

  it("500 genérico quando o refit lança", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "refit_team_ratings_failed",
    });
    error.mockRestore();
  });
});
