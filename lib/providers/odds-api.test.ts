import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCacheStore } from "@/lib/cache/in-memory";
import { getOddsForEvent, getOddsForSport } from "@/lib/providers/odds-api";

// Second-precision UTC, no milliseconds — the only form The Odds API accepts
// for commenceTimeFrom/To (regression guard for #42).
const SECOND_PRECISION_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function captureFetch(body = "[]"): { calls: URL[] } {
  const calls: URL[] = [];
  const stub = vi.fn(async (input: string | URL) => {
    calls.push(new URL(String(input)));
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return { calls };
}

const VALID_EVENT = JSON.stringify({
  id: "evt-123",
  sport_key: "soccer_fifa_world_cup",
  commence_time: "2026-06-11T19:00:00Z",
  home_team: "Mexico",
  away_team: "South Africa",
  bookmakers: [],
});

describe("odds-api request construction", () => {
  beforeEach(() => {
    process.env.ODDS_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ODDS_API_KEY;
  });

  it("strips milliseconds from commenceTime (Date#toISOString -> 422)", async () => {
    const { calls } = captureFetch();
    // Exactly what predict.ts produces: new Date(...).toISOString() -> ".000Z".
    await getOddsForSport("soccer_fifa_world_cup", {
      regions: ["eu"],
      markets: ["totals"],
      commenceTimeFrom: "2026-06-07T00:00:00.000Z",
      commenceTimeTo: "2026-07-07T12:34:56.789Z",
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("commenceTimeFrom")).toBe("2026-06-07T00:00:00Z");
    expect(params.get("commenceTimeFrom")).toMatch(SECOND_PRECISION_UTC);
    expect(params.get("commenceTimeTo")).toBe("2026-07-07T12:34:56Z");
    expect(params.get("commenceTimeTo")).toMatch(SECOND_PRECISION_UTC);
  });

  it("sends regions, markets AND a millisecond-free commenceTime together (predict.ts shape)", async () => {
    const { calls } = captureFetch();
    // The exact param set predict.ts builds: a kickoff window via toISOString().
    await getOddsForSport("soccer_brazil_campeonato", {
      regions: ["eu"],
      markets: ["totals"],
      commenceTimeFrom: "2026-06-07T18:00:00.000Z",
      commenceTimeTo: "2026-06-08T06:00:00.000Z",
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("regions")).toBe("eu");
    expect(params.get("markets")).toBe("totals");
    expect(params.get("commenceTimeFrom")).toMatch(SECOND_PRECISION_UTC);
    expect(params.get("commenceTimeTo")).toMatch(SECOND_PRECISION_UTC);
  });

  it("normalizes offset timezones to UTC and leaves second-precision input intact", async () => {
    const { calls } = captureFetch();
    await getOddsForSport("soccer_fifa_world_cup", {
      commenceTimeFrom: "2026-06-07T21:00:00+03:00", // offset -> UTC
      commenceTimeTo: "2026-06-08T06:00:00Z", // already correct, untouched
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("commenceTimeFrom")).toBe("2026-06-07T18:00:00Z");
    expect(params.get("commenceTimeTo")).toBe("2026-06-08T06:00:00Z");
  });

  it("always sends regions and markets on the sport odds request", async () => {
    const { calls } = captureFetch();
    await getOddsForSport("soccer_brazil_campeonato", {
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("regions")).toBe("eu");
    expect(params.get("markets")).toBe("totals");
  });

  it("falls back to defaults when regions/markets are empty (no MISSING_REGION)", async () => {
    const { calls } = captureFetch();
    await getOddsForSport("soccer_uefa_champs_league", {
      regions: [],
      markets: [],
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("regions")).toBe("eu");
    expect(params.get("markets")).toBe("totals");
  });

  it("also sends regions and markets on the per-event odds request", async () => {
    const { calls } = captureFetch(VALID_EVENT);
    await getOddsForEvent("soccer_fifa_world_cup", "evt-123", {
      cache: new InMemoryCacheStore(),
    });

    const params = calls[0].searchParams;
    expect(params.get("regions")).toBe("eu");
    expect(params.get("markets")).toBe("totals");
  });
});
