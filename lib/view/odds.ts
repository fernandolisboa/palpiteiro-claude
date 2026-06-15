import { formatOdd, formatPct, formatRelativeAgo } from "@/lib/format";
import {
  computeImpliedProbabilities,
  computeMarketImpliedProbabilities,
} from "@/lib/odds/implied-probability";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { MatchRowView, OddsView } from "@/lib/view/types";

export type OddsSnapshotInput = {
  bookmaker: string;
  overOdd: number | string;
  underOdd: number | string;
  capturedAt: Date;
};

// O snapshot vivo é binário over/under (the-odds-api) — o único mercado com
// reader de snapshot hoje. Resolve os rótulos por lado via registry pra
// de-hardcodar "Over 2.5"/"O"/badge dos componentes (AC3); live N-vias = Fase 4.
const LIVE_ODDS_PRESENTATION = getMarketPresentation("over_under");
// Label COMPLETO ("Over 2.5"/"Under 2.5") — só os headers do OddsCard (toOddsView).
const LIVE_OVER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "over",
  LIVE_ODDS_PRESENTATION.defaultLine,
);
const LIVE_UNDER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "under",
  LIVE_ODDS_PRESENTATION.defaultLine,
);
// Label CURTO ("Over"/"Under") — chips densos da match-list (coluna ~160px).
// Mantém a compactação pré-pivot ("O"/"U") sem o "2.5" verboso na lista.
const LIVE_OVER_SHORT = LIVE_ODDS_PRESENTATION.selectionLabel("over");
const LIVE_UNDER_SHORT = LIVE_ODDS_PRESENTATION.selectionLabel("under");

export function toOddsView(
  snapshot: OddsSnapshotInput,
  now: Date = new Date(),
): OddsView {
  const overOdd = Number(snapshot.overOdd);
  const underOdd = Number(snapshot.underOdd);
  const { overProb, underProb, overround } = computeImpliedProbabilities(
    overOdd,
    underOdd,
  );
  return {
    marketLabel: LIVE_ODDS_PRESENTATION.marketLabel,
    // Forma N-vias (#173): over/under = 2 outcomes na ordem over→under. Mesmos
    // valores/labels/formatters de antes → DOM byte-idêntico (golden pina).
    outcomes: [
      {
        label: LIVE_OVER_LABEL,
        odd: formatOdd(overOdd),
        pct: formatPct(overProb * 100, { decimals: 1 }),
      },
      {
        label: LIVE_UNDER_LABEL,
        odd: formatOdd(underOdd),
        pct: formatPct(underProb * 100, { decimals: 1 }),
      },
    ],
    bookmaker: snapshot.bookmaker,
    overround: formatPct(overround * 100, { decimals: 1 }),
    updatedAgo: formatRelativeAgo(snapshot.capturedAt, now),
  };
}

// Captura N-vias genérica (saída do reader best-effort) — o que o card 1X2 lê.
// overroundPct armazenado é IGNORADO de propósito: a view RE-DERIVA (igual ao
// over/under) pra os dois cards derivarem a implícita/overround do mesmo jeito.
export type NwayOddsInput = {
  bookmaker: string;
  capturedAt: Date;
  selections: { key: string; odd: string }[];
};

/**
 * View genérica N-vias pra mercados Σ=1 featured (1X2 hoje). RE-DERIVA probs +
 * overround do mercado COMPLETO via `computeMarketImpliedProbabilities` (nunca
 * `1/odd` cru; nunca o overroundPct armazenado — paridade com toOddsView). Labels
 * vêm do registry puro (`getMarketPresentation`) — este módulo NÃO importa
 * market-descriptor (pureza de bundle; match_result é Σ=1, não precisa de
 * impliedSumTarget). numeric do Drizzle = string → `Number()` no boundary.
 */
export function toNwayOddsView(
  snapshot: NwayOddsInput,
  marketKey: string,
  now: Date = new Date(),
): OddsView {
  const presentation = getMarketPresentation(marketKey);
  const odds = snapshot.selections.map((s) => Number(s.odd));
  const { probs, overround } = computeMarketImpliedProbabilities(odds);
  return {
    marketLabel: presentation.marketLabel,
    outcomes: snapshot.selections.map((s, i) => ({
      label: presentation.outcomeLabel(s.key, presentation.defaultLine),
      odd: formatOdd(odds[i]),
      pct: formatPct(probs[i] * 100, { decimals: 1 }),
    })),
    bookmaker: snapshot.bookmaker,
    overround: formatPct(overround * 100, { decimals: 1 }),
    updatedAgo: formatRelativeAgo(snapshot.capturedAt, now),
  };
}

export function toMatchRowOdds(
  snapshot: OddsSnapshotInput | null,
): NonNullable<MatchRowView["odds"]> | null {
  if (!snapshot) return null;
  // Forma N-vias (#173): over/under = 2 outcomes na ordem over→under, labels
  // CURTOS. Byte-idêntico ao chip binário pré-#173 (golden pina). A regra de
  // prioridade 1X2>over/under entra com a fonte N-vias (toMatchRowOddsResolved).
  return {
    outcomes: [
      { label: LIVE_OVER_SHORT, odd: formatOdd(snapshot.overOdd) },
      { label: LIVE_UNDER_SHORT, odd: formatOdd(snapshot.underOdd) },
    ],
  };
}
