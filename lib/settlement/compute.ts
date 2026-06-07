// Pure settlement math for the over/under 2.5 market. No I/O: takes a
// prediction's recommended side + entry odd + the 90' total goals and returns
// the bet result and profit in units. Kept side-effect free so it's trivially
// unit-testable and reused by both the cron settler and the manual override.

export type Recommendation = "over" | "under" | "pass";
export type OutcomeResult = "won" | "lost" | "void";

export const OVER_UNDER_LINE = 2.5;

export type SettlementInput = {
  recommendation: Recommendation;
  // Entry odd of the recommended side. Null for `pass`, and (defensively) can
  // be null on a malformed over/under prediction — see the skip case below.
  oddAtRecommendation: number | null;
  stakeUnits: number;
  totalGoals: number;
};

export type Settlement = {
  result: OutcomeResult;
  profitUnits: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Resolves a prediction against the 90' total goals.
 *
 * Returns `null` to mean "cannot settle — leave it pending" rather than
 * inventing a wrong number: a non-pass prediction missing its entry odd has no
 * basis for a profit figure, and a silent settle with a bogus profit is worse
 * than a visibly-pending row. `pass` (no-bet) settles as void/0 so it leaves
 * the pending set and counts as a resolved-but-zero entry. The 2.5 line never
 * pushes, so over/under always yields won or lost.
 */
export function computeSettlement(input: SettlementInput): Settlement | null {
  const { recommendation, oddAtRecommendation, stakeUnits, totalGoals } = input;

  if (recommendation === "pass") {
    return { result: "void", profitUnits: 0 };
  }

  if (oddAtRecommendation === null) {
    // Non-pass bet with no recorded entry odd: skip, leave pending.
    return null;
  }

  const won =
    recommendation === "over"
      ? totalGoals > OVER_UNDER_LINE
      : totalGoals < OVER_UNDER_LINE;

  const profitUnits = won
    ? round2(stakeUnits * (oddAtRecommendation - 1))
    : round2(-stakeUnits);

  return { result: won ? "won" : "lost", profitUnits };
}

/**
 * Profit in units for an explicitly chosen result — used by the manual
 * override, where an admin sets won/lost/void directly. Returns null when a
 * won/lost result is requested but there's no entry odd to price it (e.g. a
 * `pass` prediction): the caller should reject rather than guess.
 */
export function profitForResult(
  result: OutcomeResult,
  oddAtRecommendation: number | null,
  stakeUnits: number,
): number | null {
  if (result === "void") return 0;
  if (oddAtRecommendation === null) return null;
  return result === "won"
    ? round2(stakeUnits * (oddAtRecommendation - 1))
    : round2(-stakeUnits);
}
