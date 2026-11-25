import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/sync-upcoming-fixtures", () => ({
  ensureUpcomingFixturesSynced: vi.fn(),
}));
vi.mock("@/lib/sync/analyzed-kickoffs", () => ({
  rebuildAnalyzedKickoffs: vi.fn(),
}));

import { GET } from "@/app/api/cron/sync-fixtures/route";
import { rebuildAnalyzedKickoffs } from "@/lib/sync/analyzed-kickoffs";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";

const syncMock = vi.mocked(ensureUpcomingFixturesSynced);
const rebuildMock = vi.mocked(rebuildAnalyzedKickoffs);

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://x/api/cron/sync-fixtures", { headers });
}

beforeEach(() => {
  syncMock.mockReset();
  rebuildMock.mockReset().mockResolvedValue(3);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/sync-fixtures", () => {
  it("returns 401 and logs when CRON_SECRET is unset, without running the sync", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(syncMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("returns 401 on blank or wrong Authorization", async () => {
    for (const bad of ["", "Bearer wrong"]) {
      syncMock.mockReset();
      const res = await GET(req(bad));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(syncMock).not.toHaveBeenCalled();
    }
  });

  it("returns 200 {ok:true} on correct Bearer and force-runs the sync", async () => {
    syncMock.mockResolvedValue();
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledWith({ force: true });
  });

  it("returns 500 and logs when the sync throws", async () => {
    syncMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "sync_fixtures_failed",
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("401 não reconstrói o índice do portão (#680)", async () => {
    await GET(req("Bearer wrong"));
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("reconstrói o índice do portão dos crons (#680) com ou sem sucesso do sync", async () => {
    syncMock.mockResolvedValue();
    await GET(req("Bearer s3cret"));
    expect(rebuildMock).toHaveBeenCalledTimes(1);

    rebuildMock.mockClear();
    syncMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(rebuildMock).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("falha no rebuild só loga: a resposta segue a do sync", async () => {
    syncMock.mockResolvedValue();
    rebuildMock.mockRejectedValue(new Error("kv down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
