import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lineup-recheck/run", () => ({
  runLineupRechecks: vi.fn(),
}));

import { GET, maxDuration } from "@/app/api/cron/recheck-lineups/route";
import {
  runLineupRechecks,
  type LineupRecheckSummary,
} from "@/lib/lineup-recheck/run";

const runMock = vi.mocked(runLineupRechecks);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/recheck-lineups", { headers });
}

function summary(over: Partial<LineupRecheckSummary> = {}): LineupRecheckSummary {
  return {
    candidates: 0,
    matches: 0,
    alreadyDone: 0,
    lineupNotOut: 0,
    kickoffTooClose: 0,
    skippedDeadline: 0,
    dataUnavailable: 0,
    uninformative: 0,
    jevFailed: 0,
    persisted: 0,
    flipped: 0,
    oddsFromParent: 0,
    parentsSkipped: {
      not_code_jev_market: 0,
      parent_incomplete: 0,
      jev_failed: 0,
      no_odds: 0,
      superseded: 0,
      kickoff_passed: 0,
    },
    errors: 0,
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

describe("GET /api/cron/recheck-lineups", () => {
  it("orçamento inteiro do plano e agenda de 10 em 10 min, fora dos minutos cheios", () => {
    expect(maxDuration).toBe(300);
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/recheck-lineups",
      schedule: "5,15,25,35,45,55 * * * *",
    });
  });

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

  it("200 quando não há nada a fazer (sem candidato, flag OFF, lock, JEV que falhou)", async () => {
    for (const s of [
      summary(),
      summary({ skipped: "flag_off" }),
      summary({ skipped: "model_base_running" }),
      summary({ skipped: "locked" }),
      summary({ candidates: 2, matches: 1, lineupNotOut: 1 }),
      summary({ candidates: 2, matches: 1, jevFailed: 1 }),
    ]) {
      runMock.mockResolvedValue(s);
      const res = await GET(req("Bearer s3cret"));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, summary: s });
    }
  });

  it("500 com o resumo quando uma reconferência deu erro", async () => {
    const s = summary({ candidates: 1, matches: 1, errors: 1 });
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
      error: "recheck_lineups_failed",
    });
    error.mockRestore();
  });
});
