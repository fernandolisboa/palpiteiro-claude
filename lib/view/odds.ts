import { formatOdd, formatPct, formatRelativeAgo } from "@/lib/format";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import type { OddsView } from "@/lib/view/types";

export type OddsSnapshotInput = {
  bookmaker: string;
  overOdd: number | string;
  underOdd: number | string;
  capturedAt: Date;
};

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
): { over: string; under: string } | null {
  if (!snapshot) return null;
  return {
    over: formatOdd(snapshot.overOdd),
    under: formatOdd(snapshot.underOdd),
  };
}
