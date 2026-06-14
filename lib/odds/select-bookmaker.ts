import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import type { MarketDescriptor } from "@/lib/odds/market-descriptor";
import { OVER_UNDER } from "@/lib/odds/market-descriptor";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

export type OddsBundle = {
  bookmakerKey: string;
  bookmakerTitle: string;
  overOdd: number;
  underOdd: number;
  capturedAt: string;
};

/**
 * Bundle de odds de UM mercado completo de UM bookmaker — a generalização N-vias
 * de `OddsBundle` (par over/under).
 *
 * `lastUpdate` é o `market.last_update` (STRING) do provider — usado SÓ pro input
 * do LLM (preserva `OddsBundle.capturedAt` byte-a-byte no wrapper binário). NÃO é
 * o `captured_at` PERSISTIDO: esse é o `now` de escrita, definido na ingestão
 * (ver `ensureOddsSnapshotsFresh`). `bookmakerKey` não é load-bearing downstream
 * (o schema guarda o title, não a key).
 */
export type MarketOddsBundle = {
  bookmakerKey: string;
  bookmakerTitle: string;
  lastUpdate: string;
  selections: { key: string; odd: number }[];
  overround: number;
};

/**
 * Quando mais de um bookmaker oferece o mercado completo (TODAS as seleções do
 * `descriptor`) pro mesmo evento, escolhe o de MENOR overround do MERCADO COMPLETO
 * (via `computeMarketImpliedProbabilities`): probabilidade implícita mais "honesta"
 * → edge calculado contra o mercado mais eficiente disponível e evita recomendar
 * contra odds artificialmente generosas de bookmakers exóticos (ver CLAUDE.md
 * "Edge calculation"). Books que NÃO oferecem TODAS as seleções são descartados.
 * Retorna null se nenhum bookmaker tem o mercado completo.
 */
export function pickBestBookmaker(args: {
  event: OddsApiEventOdds;
  match: { homeTeam: string; awayTeam: string };
  descriptor: MarketDescriptor;
}): MarketOddsBundle | null {
  const { event, match, descriptor } = args;
  let best: MarketOddsBundle | null = null;

  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find(
      (m) => m.key === descriptor.providerMarketKey,
    );
    if (!market) continue;

    // Mapeia outcomes → dbSelectionKey; coleta a odd de cada seleção esperada.
    const byKey = new Map<string, number>();
    for (const outcome of market.outcomes) {
      const key = descriptor.resolveSelectionKey(
        outcome,
        { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        descriptor.params,
      );
      if (key === null) continue;
      // primeira ocorrência vence — outcomes duplicados são ignorados.
      if (!byKey.has(key)) byKey.set(key, outcome.price);
    }

    // Exige o mercado COMPLETO: todas as selectionKeys presentes. Senão, descarta.
    const selections: { key: string; odd: number }[] = [];
    let complete = true;
    for (const key of descriptor.selectionKeys) {
      const odd = byKey.get(key);
      if (odd === undefined) {
        complete = false;
        break;
      }
      selections.push({ key, odd });
    }
    if (!complete) continue;

    // Pula um book com QUALQUER odd inválida (≤1 ou não-finita): uma odd ≤1 não
    // existe como aposta e faria computeMarketImpliedProbabilities LANÇAR
    // (assertValidOdd), poisonando TODO o evento (não só o book). Trata como
    // inutilizável, igual a incompleto. O payload real de dupla chance já trouxe
    // `price: 1.0` num favorito extremo (1xBet, Copa) — isso é frequente, não raro.
    if (selections.some((s) => !Number.isFinite(s.odd) || s.odd <= 1)) continue;

    const { overround } = computeMarketImpliedProbabilities(
      selections.map((s) => s.odd),
    );
    if (!best || overround < best.overround) {
      best = {
        bookmakerKey: bookmaker.key,
        bookmakerTitle: bookmaker.title,
        lastUpdate: market.last_update,
        selections,
        overround,
      };
    }
  }

  return best;
}

/**
 * Wrapper binário (over/under) — assinatura, shape e nome preservados pros
 * consumidores existentes (predict.ts:356, fetch-and-snapshot:109). Delega ao
 * `pickBestBookmaker` genérico com o descriptor OVER_UNDER e remapeia o
 * `MarketOddsBundle` (seleções 'over'/'under') de volta pro `OddsBundle` binário.
 * Bit-exato com a versão anterior: o overround do core N-ário em N=2 é a mesma
 * ordem de operações float do `1/over + 1/under - 1` inline (ver implied-probability.ts).
 * `capturedAt` = `market.last_update` do provider (string), idêntico ao anterior.
 */
export function pickBestTotalsBookmaker(
  event: OddsApiEventOdds,
): OddsBundle | undefined {
  const bundle = pickBestBookmaker({
    event,
    match: { homeTeam: event.home_team, awayTeam: event.away_team },
    descriptor: OVER_UNDER,
  });
  if (!bundle) return undefined;
  const over = bundle.selections.find((s) => s.key === "over");
  const under = bundle.selections.find((s) => s.key === "under");
  // OVER_UNDER.selectionKeys garante ambos quando o bundle existe (mercado completo).
  if (!over || !under) return undefined;
  return {
    bookmakerKey: bundle.bookmakerKey,
    bookmakerTitle: bundle.bookmakerTitle,
    overOdd: over.odd,
    underOdd: under.odd,
    capturedAt: bundle.lastUpdate,
  };
}
