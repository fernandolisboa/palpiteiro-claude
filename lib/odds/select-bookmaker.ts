import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

export type OddsBundle = {
  bookmakerKey: string;
  bookmakerTitle: string;
  overOdd: number;
  underOdd: number;
  capturedAt: string;
};

/**
 * Quando mais de um bookmaker oferece totals 2.5 pro mesmo evento, escolhe o
 * de MENOR overround: probabilidade implícita mais "honesta" → edge calculado
 * contra o mercado mais eficiente disponível e evita recomendar contra odds
 * artificialmente generosas de bookmakers exóticos (ver CLAUDE.md "Edge
 * calculation"). Retorna undefined se nenhum bookmaker tem o par over/under
 * 2.5 completo.
 */
export function pickBestTotalsBookmaker(
  event: OddsApiEventOdds,
): OddsBundle | undefined {
  let best: { bundle: OddsBundle; overround: number } | undefined;
  for (const bookmaker of event.bookmakers) {
    const totals = bookmaker.markets.find((m) => m.key === "totals");
    if (!totals) continue;
    let over: number | undefined;
    let under: number | undefined;
    for (const outcome of totals.outcomes) {
      if (outcome.point !== 2.5) continue;
      if (outcome.name.toLowerCase() === "over") over = outcome.price;
      if (outcome.name.toLowerCase() === "under") under = outcome.price;
    }
    if (over === undefined || under === undefined) continue;
    const overround = 1 / over + 1 / under - 1;
    if (!best || overround < best.overround) {
      best = {
        bundle: {
          bookmakerKey: bookmaker.key,
          bookmakerTitle: bookmaker.title,
          overOdd: over,
          underOdd: under,
          capturedAt: totals.last_update,
        },
        overround,
      };
    }
  }
  return best?.bundle;
}
