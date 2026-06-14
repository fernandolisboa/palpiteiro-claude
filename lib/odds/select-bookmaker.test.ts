import { describe, expect, it } from "vitest";

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  DOUBLE_CHANCE,
  MATCH_RESULT,
  OVER_UNDER,
} from "@/lib/odds/market-descriptor";
import {
  pickBestBookmaker,
  pickBestTotalsBookmaker,
} from "@/lib/odds/select-bookmaker";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

function totalsBook(
  key: string,
  title: string,
  over: number,
  under: number,
  point = 2.5,
  lastUpdate = "2026-05-15T12:00:00Z",
) {
  return {
    key,
    title,
    last_update: lastUpdate,
    markets: [
      {
        key: "totals",
        last_update: lastUpdate,
        outcomes: [
          { name: "Over", price: over, point },
          { name: "Under", price: under, point },
        ],
      },
    ],
  };
}

function h2hBook(
  key: string,
  title: string,
  prices: { home: number; draw: number; away: number },
  names: { home: string; draw: string; away: string },
  lastUpdate = "2026-05-15T12:00:00Z",
) {
  return {
    key,
    title,
    last_update: lastUpdate,
    markets: [
      {
        key: "h2h",
        last_update: lastUpdate,
        outcomes: [
          { name: names.home, price: prices.home },
          { name: names.draw, price: prices.draw },
          { name: names.away, price: prices.away },
        ],
      },
    ],
  };
}

function event(bookmakers: ReturnType<typeof totalsBook>[]): OddsApiEventOdds {
  return {
    id: "evt-1",
    sport_key: "soccer_brazil_campeonato",
    commence_time: "2026-05-15T19:00:00Z",
    home_team: "CR Flamengo",
    away_team: "Fluminense FC",
    bookmakers,
  };
}

// Book de dupla chance no formato REAL do provider: outcomes com nomes de time
// COMPOSTOS, ordem livre ("{away} or {home}" pro 12).
function dcBook(
  key: string,
  title: string,
  prices: { hd: number; ad: number; ha: number },
  home = "Germany",
  away = "Curaçao",
  lastUpdate = "2026-06-14T14:29:15Z",
) {
  return {
    key,
    title,
    last_update: lastUpdate,
    markets: [
      {
        key: "double_chance",
        last_update: lastUpdate,
        outcomes: [
          { name: `${home} or Draw`, price: prices.hd },
          { name: `${away} or Draw`, price: prices.ad },
          { name: `${away} or ${home}`, price: prices.ha },
        ],
      },
    ],
  };
}

function dcEvent(
  bookmakers: ReturnType<typeof dcBook>[],
): OddsApiEventOdds {
  return {
    id: "evt-dc",
    sport_key: "soccer_fifa_world_cup",
    commence_time: "2026-06-14T17:00:00Z",
    home_team: "Germany",
    away_team: "Curaçao",
    bookmakers,
  } as OddsApiEventOdds;
}

const DC_MATCH = { homeTeam: "Germany", awayTeam: "Curaçao" };

describe("pickBestBookmaker — DOUBLE_CHANCE (nomes compostos + book inválido)", () => {
  it("resolve um book 1xBet-style (3 outcomes compostos, ordem livre) → bundle com as 3 duplas", () => {
    const bundle = pickBestBookmaker({
      event: dcEvent([
        dcBook("onexbet", "1xBet", { hd: 1.27, ad: 1.73, ha: 1.36 }),
      ]),
      match: DC_MATCH,
      descriptor: DOUBLE_CHANCE,
    });
    expect(bundle).not.toBeNull();
    expect(bundle!.selections.map((s) => s.key).sort()).toEqual([
      "away_or_draw",
      "home_or_away",
      "home_or_draw",
    ]);
  });

  it("pula um book com odd 1.0 (favorito extremo do payload real) e ainda escolhe o book válido", () => {
    const bundle = pickBestBookmaker({
      event: dcEvent([
        dcBook("onexbet", "1xBet", { hd: 1.0, ad: 14.5, ha: 1.01 }), // odd 1.0 → inválido
        dcBook("williamhill", "William Hill", { hd: 1.18, ad: 5.0, ha: 1.3 }),
      ]),
      match: DC_MATCH,
      descriptor: DOUBLE_CHANCE,
    });
    // sem o skip por book, o 1.0 faria computeMarketImpliedProbabilities lançar e
    // derrubar o evento inteiro. Com o fix, o 1xBet é pulado e o válido é escolhido.
    expect(bundle).not.toBeNull();
    expect(bundle!.bookmakerKey).toBe("williamhill");
  });

  it("book incompleto (uma dupla não resolve) → descartado (null se for o único)", () => {
    const incomplete = {
      key: "x",
      title: "X",
      last_update: "2026-06-14T14:29:15Z",
      markets: [
        {
          key: "double_chance",
          last_update: "2026-06-14T14:29:15Z",
          outcomes: [
            { name: "Germany or Draw", price: 1.27 },
            { name: "Curaçao or Draw", price: 1.73 },
            // falta a 12 → mercado incompleto
          ],
        },
      ],
    };
    const bundle = pickBestBookmaker({
      event: dcEvent([incomplete as unknown as ReturnType<typeof dcBook>]),
      match: DC_MATCH,
      descriptor: DOUBLE_CHANCE,
    });
    expect(bundle).toBeNull();
  });
});

describe("pickBestBookmaker — OVER_UNDER", () => {
  it("matches pickBestTotalsBookmaker bit-for-bit (same book, odds, overround)", () => {
    const evt = event([
      totalsBook("a", "Book A", 1.95, 1.9), // overround maior
      totalsBook("b", "Book B", 1.9, 1.95), // overround menor
    ]);

    const generic = pickBestBookmaker({
      event: evt,
      match: { homeTeam: evt.home_team, awayTeam: evt.away_team },
      descriptor: OVER_UNDER,
    });
    const binary = pickBestTotalsBookmaker(evt);

    expect(generic).not.toBeNull();
    expect(binary).toBeDefined();
    // mesmo book escolhido
    expect(generic!.bookmakerTitle).toBe(binary!.bookmakerTitle);
    expect(generic!.bookmakerKey).toBe(binary!.bookmakerKey);
    // mesmas odds, na ordem canônica over/under
    expect(generic!.selections).toEqual([
      { key: "over", odd: binary!.overOdd },
      { key: "under", odd: binary!.underOdd },
    ]);
    // overround idêntico ao core N-ário (bit-exato com o inline anterior)
    const { overround } = computeMarketImpliedProbabilities([
      binary!.overOdd,
      binary!.underOdd,
    ]);
    expect(generic!.overround).toBe(overround);
    // lastUpdate (provider) preservado byte-a-byte no capturedAt do wrapper
    expect(binary!.capturedAt).toBe(generic!.lastUpdate);
  });

  it("discards books without the complete over/under pair", () => {
    const incompleteOnly = event([
      {
        key: "x",
        title: "Book X",
        last_update: "2026-05-15T12:00:00Z",
        markets: [
          {
            key: "totals",
            last_update: "2026-05-15T12:00:00Z",
            outcomes: [{ name: "Over", price: 1.9, point: 2.5 }], // sem Under
          },
        ],
      },
    ]);
    expect(
      pickBestBookmaker({
        event: incompleteOnly,
        match: { homeTeam: "a", awayTeam: "b" },
        descriptor: OVER_UNDER,
      }),
    ).toBeNull();
    expect(pickBestTotalsBookmaker(incompleteOnly)).toBeUndefined();
  });

  it("ignores outcomes on a different line (point mismatch)", () => {
    const wrongLine = event([totalsBook("a", "Book A", 1.9, 1.95, 3.5)]);
    expect(
      pickBestBookmaker({
        event: wrongLine,
        match: { homeTeam: "a", awayTeam: "b" },
        descriptor: OVER_UNDER,
      }),
    ).toBeNull();
  });

  it("returns null when no book offers totals at all", () => {
    expect(pickBestTotalsBookmaker(event([]))).toBeUndefined();
  });
});

describe("pickBestBookmaker — MATCH_RESULT (1X2, N=3)", () => {
  const match = { homeTeam: "CR Flamengo", awayTeam: "Fluminense FC" };

  it("picks the complete h2h book with the lowest overround, mapping draw + teams", () => {
    const evt: OddsApiEventOdds = {
      id: "evt-1",
      sport_key: "soccer_brazil_campeonato",
      commence_time: "2026-05-15T19:00:00Z",
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      bookmakers: [
        // overround maior
        h2hBook(
          "a",
          "Book A",
          { home: 2.0, draw: 3.0, away: 3.5 },
          { home: "Flamengo", draw: "Draw", away: "Fluminense" },
        ),
        // overround menor (odds mais generosas no mesmo conjunto)
        h2hBook(
          "b",
          "Book B",
          { home: 2.1, draw: 3.4, away: 3.9 },
          { home: "CR Flamengo", draw: "Draw", away: "Fluminense FC" },
        ),
      ],
    };

    const bundle = pickBestBookmaker({ event: evt, match, descriptor: MATCH_RESULT });
    expect(bundle).not.toBeNull();
    expect(bundle!.bookmakerTitle).toBe("Book B");
    // ordem canônica home/draw/away (selectionKeys)
    expect(bundle!.selections.map((s) => s.key)).toEqual(["home", "draw", "away"]);
    expect(bundle!.selections.map((s) => s.odd)).toEqual([2.1, 3.4, 3.9]);
    const { overround } = computeMarketImpliedProbabilities([2.1, 3.4, 3.9]);
    expect(bundle!.overround).toBe(overround);
  });

  it("matches team names via teamsMatch, not exact equality (divergent spellings)", () => {
    const evt: OddsApiEventOdds = {
      id: "evt-1",
      sport_key: "soccer_brazil_campeonato",
      commence_time: "2026-05-15T19:00:00Z",
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      bookmakers: [
        h2hBook(
          "a",
          "Book A",
          { home: 2.0, draw: 3.2, away: 3.7 },
          { home: "Flamengo RJ", draw: "Empate", away: "Fluminense" },
        ),
      ],
    };
    // "Empate" não casa 'draw' → mercado incompleto → descartado
    expect(pickBestBookmaker({ event: evt, match, descriptor: MATCH_RESULT })).toBeNull();
  });

  it("discards a book missing one of the three outcomes", () => {
    const evt: OddsApiEventOdds = {
      id: "evt-1",
      sport_key: "soccer_brazil_campeonato",
      commence_time: "2026-05-15T19:00:00Z",
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      bookmakers: [
        {
          key: "a",
          title: "Book A",
          last_update: "2026-05-15T12:00:00Z",
          markets: [
            {
              key: "h2h",
              last_update: "2026-05-15T12:00:00Z",
              outcomes: [
                { name: "CR Flamengo", price: 2.0 },
                { name: "Draw", price: 3.2 },
                // sem away
              ],
            },
          ],
        },
      ],
    };
    expect(pickBestBookmaker({ event: evt, match, descriptor: MATCH_RESULT })).toBeNull();
  });
});
