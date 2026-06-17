import { describe, expect, it, vi } from "vitest";

import { OddsFallbackProvider } from "@/lib/providers/odds/fallback-provider";
import type { NormalizedOddsEvent, OddsProvider } from "@/lib/providers/odds/types";

const BR = "soccer_brazil_campeonato";
const CL = "soccer_uefa_champs_league";

function ev(id: string): NormalizedOddsEvent {
  return { id, commenceTime: "", homeTeam: "", awayTeam: "", bookmakers: [] };
}

function fakeProvider(
  name: string,
  supports: (a: { sportKey: string; providerMarketKey: string }) => boolean,
): OddsProvider {
  return {
    capabilities: { name, supportedLeagues: new Set() },
    supportsMarket: supports,
    getOddsForSport: vi.fn().mockResolvedValue([ev(name)]),
    getOddsForEvent: vi.fn().mockResolvedValue(ev(name)),
    getEventsForSport: vi.fn().mockResolvedValue([{ id: name, commenceTime: "", homeTeam: "", awayTeam: "" }]),
  };
}

// primary = api-football (bet_10/bet_92/bet_212 + BR); fallback = The Odds API
// (tudo não-bet_). Espelha o supportsMarket real do ApiFootballOddsAdapter.
const AF_BET_KEYS = new Set(["bet_10", "bet_92", "bet_212"]);
function build() {
  const primary = fakeProvider(
    "af",
    (a) => AF_BET_KEYS.has(a.providerMarketKey) && a.sportKey === BR,
  );
  const fallback = fakeProvider("toa", (a) => !a.providerMarketKey.startsWith("bet_"));
  return { primary, fallback, composite: new OddsFallbackProvider(primary, fallback) };
}

describe("OddsFallbackProvider (router por capability)", () => {
  it("roteia bet_10 + Brasileirão pro primary (api-football), repassando options", async () => {
    const { primary, fallback, composite } = build();
    const events = await composite.getOddsForSport(BR, { markets: ["bet_10"] });
    expect(primary.getOddsForSport).toHaveBeenCalledWith(BR, { markets: ["bet_10"] });
    expect(fallback.getOddsForSport).not.toHaveBeenCalled();
    expect(events[0].id).toBe("af");
  });

  it("roteia bet_92/bet_212 (scorer/assist) + Brasileirão pro primary (#290)", async () => {
    for (const market of ["bet_92", "bet_212"]) {
      const { primary, fallback, composite } = build();
      await composite.getOddsForSport(BR, { markets: [market] });
      expect(primary.getOddsForSport).toHaveBeenCalledWith(BR, { markets: [market] });
      expect(fallback.getOddsForSport).not.toHaveBeenCalled();
    }
  });

  it("roteia totals/h2h/btts pro fallback (The Odds API) — passthrough byte-idêntico", async () => {
    for (const market of ["totals", "h2h", "btts", "double_chance", "alternate_totals"]) {
      const { primary, fallback, composite } = build();
      const events = await composite.getOddsForSport(BR, { markets: [market] });
      expect(fallback.getOddsForSport).toHaveBeenCalledWith(BR, { markets: [market] });
      expect(primary.getOddsForSport).not.toHaveBeenCalled();
      expect(events[0].id).toBe("toa");
    }
  });

  it("markets undefined → fallback (preserva o default ['totals'] do fio)", async () => {
    const { primary, fallback, composite } = build();
    await composite.getOddsForSport(BR);
    expect(fallback.getOddsForSport).toHaveBeenCalledWith(BR, undefined);
    expect(primary.getOddsForSport).not.toHaveBeenCalled();
  });

  it("getOddsForEvent (btts) → fallback", async () => {
    const { primary, fallback, composite } = build();
    await composite.getOddsForEvent(BR, "evt-1", { markets: ["btts"] });
    expect(fallback.getOddsForEvent).toHaveBeenCalledWith(BR, "evt-1", { markets: ["btts"] });
    expect(primary.getOddsForEvent).not.toHaveBeenCalled();
  });

  it("getEventsForSport SEMPRE → fallback (lista grátis é da The Odds API)", async () => {
    const { primary, fallback, composite } = build();
    await composite.getEventsForSport(BR);
    expect(fallback.getEventsForSport).toHaveBeenCalledWith(BR, undefined);
    expect(primary.getEventsForSport).not.toHaveBeenCalled();
  });

  it("bet_10 em liga NÃO-Brasileirão → throw (nenhum provider único cobre)", async () => {
    const { composite } = build();
    await expect(
      composite.getOddsForSport(CL, { markets: ["bet_10"] }),
    ).rejects.toThrow(/nenhum provider/);
  });

  it("supportsMarket = união dos dois adapters", () => {
    const { composite } = build();
    expect(composite.supportsMarket({ sportKey: BR, providerMarketKey: "bet_10" })).toBe(true);
    expect(composite.supportsMarket({ sportKey: BR, providerMarketKey: "totals" })).toBe(true);
    expect(composite.supportsMarket({ sportKey: CL, providerMarketKey: "bet_10" })).toBe(false);
  });
});
