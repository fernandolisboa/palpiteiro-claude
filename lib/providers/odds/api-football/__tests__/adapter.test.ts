import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFootballOddsAdapter } from "@/lib/providers/odds/api-football/adapter";
import { getCorrectScoreOdds } from "@/lib/providers/odds/api-football/client";
import type { ApiFootballOddsItem } from "@/lib/providers/odds/api-football/schemas";
import { NormalizedOddsEventSchema } from "@/lib/providers/odds/types";
import { getFixturesByLeague } from "@/lib/providers/sports-data/api-football/adapter";
import type { ApiFootballFixture } from "@/lib/providers/sports-data/api-football/schemas";

vi.mock("@/lib/providers/odds/api-football/client", () => ({
  getCorrectScoreOdds: vi.fn(),
}));
vi.mock("@/lib/providers/sports-data/api-football/adapter", () => ({
  getFixturesByLeague: vi.fn(),
}));

const oddsItem: ApiFootballOddsItem = {
  fixture: { id: 12345 },
  update: "2026-07-22T20:00:00+00:00",
  bookmakers: [
    {
      id: 8,
      name: "Bet365",
      bets: [
        {
          id: 10,
          name: "Exact Score",
          values: [
            { value: "1:0", odd: "8.50" },
            { value: "2:1", odd: "11.00" },
            { value: "Any Other Score", odd: "3.20" },
          ],
        },
      ],
    },
  ],
};

// Só os campos que o adapter lê (fixture.id/date + teams). Cast parcial.
const fixture = {
  fixture: { id: 12345, date: "2026-07-22T23:00:00+00:00" },
  teams: { home: { id: 1, name: "Flamengo" }, away: { id: 2, name: "Palmeiras" } },
} as unknown as ApiFootballFixture;

const BR = "soccer_brazil_campeonato";

describe("ApiFootballOddsAdapter", () => {
  const adapter = new ApiFootballOddsAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("capabilities: api-football-odds, só Brasileirão", () => {
    expect(adapter.capabilities.name).toBe("api-football-odds");
    expect(adapter.capabilities.supportedLeagues.has("brasileirao_a")).toBe(true);
    expect(adapter.capabilities.supportedLeagues.has("world_cup")).toBe(false);
  });

  it("supportsMarket: só bet_10 + Brasileirão", () => {
    expect(adapter.supportsMarket({ sportKey: BR, providerMarketKey: "bet_10" })).toBe(true);
    expect(adapter.supportsMarket({ sportKey: BR, providerMarketKey: "totals" })).toBe(false);
    expect(
      adapter.supportsMarket({ sportKey: "soccer_uefa_champs_league", providerMarketKey: "bet_10" }),
    ).toBe(false);
  });

  it("normaliza /odds bet=10 → NormalizedOddsEvent com times enriquecidos + price number", async () => {
    vi.mocked(getCorrectScoreOdds).mockResolvedValue([oddsItem]);
    vi.mocked(getFixturesByLeague).mockResolvedValue([fixture]);

    const events = await adapter.getOddsForSport(BR);
    expect(events).toHaveLength(1);
    const event = events[0];

    expect(NormalizedOddsEventSchema.parse(event)).toEqual(event);
    expect(event.id).toBe("12345");
    expect(event.homeTeam).toBe("Flamengo"); // enriquecido (não vem no /odds)
    expect(event.awayTeam).toBe("Palmeiras");
    expect(event.commenceTime).toBe("2026-07-22T23:00:00+00:00");

    const market = event.bookmakers[0].markets[0];
    expect(market.key).toBe("bet_10"); // casa contra descriptor.providerMarketKey
    expect(market.lastUpdate).toBe("2026-07-22T20:00:00+00:00");
    // STRING "8.50" → number 8.5 (o único transform do adapter).
    expect(market.outcomes[0]).toEqual({ name: "1:0", price: 8.5 });
    expect(typeof market.outcomes[0].price).toBe("number");
    // outcomes passam verbatim — o grid/drop é do descriptor.resolveSelectionKey.
    expect(market.outcomes.map((o) => o.name)).toEqual(["1:0", "2:1", "Any Other Score"]);
  });

  it("dropa odds sem metadata de fixture pareável (não inventa times)", async () => {
    vi.mocked(getCorrectScoreOdds).mockResolvedValue([oddsItem]);
    vi.mocked(getFixturesByLeague).mockResolvedValue([]);
    expect(await adapter.getOddsForSport(BR)).toEqual([]);
  });

  it("sportKey não-Brasileirão → sem eventos (capability gate)", async () => {
    expect(await adapter.getOddsForSport("soccer_uefa_champs_league")).toEqual([]);
    expect(getCorrectScoreOdds).not.toHaveBeenCalled();
  });

  it("getOddsForEvent / getEventsForSport lançam (correct score é batch)", async () => {
    await expect(adapter.getOddsForEvent(BR, "evt-1")).rejects.toThrow();
    await expect(adapter.getEventsForSport(BR)).rejects.toThrow();
  });
});
