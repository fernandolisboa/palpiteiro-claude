import { describe, expect, it } from "vitest";

import {
  BTTS,
  DOUBLE_CHANCE,
  OVER_UNDER_ALT,
  type MarketDescriptor,
} from "@/lib/odds/market-descriptor";
import { pickBestBookmaker } from "@/lib/odds/select-bookmaker";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

import payloads from "./fixtures/odds-api-additional-2026-09-25.json";

// Payloads REAIS de /events/{id}/odds (regions=eu, markets=btts,double_chance,
// alternate_totals) capturados em 2026-09-25, já na forma normalizada. A escada de
// alternate_totals foi aparada pras candidateLines (1.5/2.5/3.5). Os nomes do
// match são os canônicos do DB (não os do provider), como no fetch real.
const CASES: {
  league: SupportedLeague;
  event: NormalizedOddsEvent;
  match: { homeTeam: string; awayTeam: string };
}[] = [
  {
    league: "brasileirao_a",
    event: payloads.BRASILEIRAO,
    match: { homeTeam: "São Paulo FC", awayTeam: "Santos FC" },
  },
  {
    league: "champions_league",
    event: payloads.CHAMPIONS,
    match: { homeTeam: "Arsenal FC", awayTeam: "Lille OSC" },
  },
];

const ADDITIONAL: MarketDescriptor[] = [BTTS, DOUBLE_CHANCE, OVER_UNDER_ALT];

describe.each(CASES)(
  "cobertura additional — $league",
  ({ league, event, match }) => {
    it.each(ADDITIONAL)(
      "$dbMarketKey ($providerMarketKey) cobre a liga",
      (d) => {
        expect(d.coveredLeagues).toContain(league);
      }
    );

    it("btts: resolve um book completo yes/no", () => {
      const bundle = pickBestBookmaker({ event, match, descriptor: BTTS });
      expect(bundle).not.toBeNull();
      expect(bundle!.selections.map((s) => s.key).sort()).toEqual([
        "no",
        "yes",
      ]);
    });

    it("dupla chance: casa os nomes compostos do provider contra os nomes do DB", () => {
      const bundle = pickBestBookmaker({
        event,
        match,
        descriptor: DOUBLE_CHANCE,
      });
      expect(bundle).not.toBeNull();
      expect(bundle!.selections.map((s) => s.key).sort()).toEqual([
        "away_or_draw",
        "home_or_away",
        "home_or_draw",
      ]);
      // Sanidade do mapeamento: o favorito (mandante nos dois jogos) tem 1X mais
      // curto que X2 — um swap home/away inverteria isso.
      const odd = (k: string) =>
        bundle!.selections.find((s) => s.key === k)!.odd;
      expect(odd("home_or_draw")).toBeLessThan(odd("away_or_draw"));
    });

    it.each(OVER_UNDER_ALT.candidateLines!)(
      "alternate_totals: resolve over/under na linha %s",
      (line) => {
        const bundle = pickBestBookmaker({
          event,
          match,
          descriptor: OVER_UNDER_ALT,
          params: { line },
        });
        expect(bundle).not.toBeNull();
        expect(bundle!.selections.map((s) => s.key).sort()).toEqual([
          "over",
          "under",
        ]);
      }
    );
  }
);
