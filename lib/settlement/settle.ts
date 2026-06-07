import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
} from "@/lib/providers/sports-data/types";
import { getPendingSettlementPredictions } from "@/lib/db/queries/predictions";
import { insertOutcomeIfAbsent } from "@/lib/db/queries/prediction-outcomes";
import { computeSettlement } from "@/lib/settlement/compute";

export type SettlementSummary = {
  considered: number;
  settled: number; // newly written outcome rows
  alreadySettled: number; // idempotent no-op (conflict on re-run)
  skipped: number; // match not final, or non-pass bet missing entry odd
  errors: number; // provider lookup failed for the match
  byResult: { won: number; lost: number; void: number };
};

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "settlement", event, ...data }));
}

/**
 * Settles every pending prediction whose match has a 90' result. Idempotent
 * (insertOutcomeIfAbsent + UNIQUE predictionId), so safe to re-run. Fetches the
 * fixture result once per distinct match (cached at the provider), reads the
 * regulation 90' score, and writes won/lost/void. Matches that are postponed,
 * cancelled, or not yet finished are left pending; a non-pass prediction with
 * no recorded entry odd is skipped rather than settled with a bogus profit.
 */
export async function settlePendingPredictions(
  now: Date = new Date(),
): Promise<SettlementSummary> {
  const pending = await getPendingSettlementPredictions(now);
  const summary: SettlementSummary = {
    considered: pending.length,
    settled: 0,
    alreadySettled: 0,
    skipped: 0,
    errors: 0,
    byResult: { won: 0, lost: 0, void: 0 },
  };
  if (pending.length === 0) {
    log("noop", { reason: "no_pending" });
    return summary;
  }

  const provider = getSportsDataProvider();

  // Resolve each distinct match once. undefined = lookup failed (record so the
  // predictions on that match are counted as errors, not silently skipped).
  const resultByMatch = new Map<
    string,
    NormalizedFixtureResult | undefined | null
  >();
  for (const p of pending) {
    if (resultByMatch.has(p.matchId)) continue;
    const ref: FixtureRef = {
      league: p.league,
      kickoffAt: p.kickoffAt.toISOString(),
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
    };
    try {
      resultByMatch.set(p.matchId, await provider.getFixtureResult(ref));
    } catch (err) {
      log("provider_error", {
        matchId: p.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
      resultByMatch.set(p.matchId, null);
    }
  }

  for (const p of pending) {
    const result = resultByMatch.get(p.matchId);
    if (result === null) {
      summary.errors += 1;
      continue;
    }
    // Only settle on a finished 90' score. postponed/cancelled/live/scheduled
    // or a missing fixture → leave pending (may reschedule or resolve later).
    if (!result || result.status !== "finished" || !result.regulationScore) {
      summary.skipped += 1;
      continue;
    }

    const totalGoals =
      result.regulationScore.home + result.regulationScore.away;
    const settlement = computeSettlement({
      recommendation: p.recommendation,
      oddAtRecommendation:
        p.oddAtRecommendation !== null ? Number(p.oddAtRecommendation) : null,
      stakeUnits: Number(p.stakeUnits),
      totalGoals,
    });
    if (settlement === null) {
      // Non-pass bet with no entry odd: can't compute profit, leave pending.
      log("skip_no_entry_odd", { predictionId: p.predictionId });
      summary.skipped += 1;
      continue;
    }

    const inserted = await insertOutcomeIfAbsent({
      predictionId: p.predictionId,
      totalGoals,
      result: settlement.result,
      profitUnits: settlement.profitUnits,
    });
    if (inserted) {
      summary.settled += 1;
      summary.byResult[settlement.result] += 1;
      log("settled", {
        predictionId: p.predictionId,
        matchId: p.matchId,
        result: settlement.result,
        totalGoals,
        profitUnits: settlement.profitUnits,
      });
    } else {
      summary.alreadySettled += 1;
    }
  }

  log("done", { ...summary });
  return summary;
}
