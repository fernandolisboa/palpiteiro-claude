import { formatOdd, formatPct, formatRelativeAgo } from "@/lib/format";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
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
const LIVE_OVER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "over",
  LIVE_ODDS_PRESENTATION.defaultLine,
);
const LIVE_UNDER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "under",
  LIVE_ODDS_PRESENTATION.defaultLine,
);

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
    overLabel: LIVE_OVER_LABEL,
    underLabel: LIVE_UNDER_LABEL,
    over: formatOdd(overOdd),
    under: formatOdd(underOdd),
    overPct: formatPct(overProb * 100, { decimals: 1 }),
    underPct: formatPct(underProb * 100, { decimals: 1 }),
    bookmaker: snapshot.bookmaker,
    overround: formatPct(overround * 100, { decimals: 1 }),
    updatedAgo: formatRelativeAgo(snapshot.capturedAt, now),
  };
}

export function toMatchRowOdds(
  snapshot: OddsSnapshotInput | null,
): NonNullable<MatchRowView["odds"]> | null {
  if (!snapshot) return null;
  return {
    overLabel: LIVE_OVER_LABEL,
    over: formatOdd(snapshot.overOdd),
    underLabel: LIVE_UNDER_LABEL,
    under: formatOdd(snapshot.underOdd),
  };
}
