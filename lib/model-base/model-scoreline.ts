import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

import { MATCH_MODEL_MAX_AGE_MS, MATCH_MODEL_VERSION } from "./version";

// Modelo de placar do jogo lido da base (#555/ADR 0052), sem buscar tabela nem ratings.
// Consumido pela porta única das apostas, resolveSlipModel (lib/bets/slip-model.ts, #560).

export const MODEL_SCORELINE_MAX_AGE_MS = MATCH_MODEL_MAX_AGE_MS;

/**
 * O MESMO ModelScoreline de getModelScoreline (lib/quant/match-model.ts), lido da última
 * base do jogo: source = lambda_source, degraded = lambda_degraded, λ = o AJUSTADO
 * (pós-JEV quando aplicado), rho/fallbackReason ausentes quando null, matriz refeita com
 * o mesmo λ/ρ e `baseCheckedAt` = o `checked_at` da base (o "calculado há" da tabela de
 * mercados, #576). null quando: sem base; versão ≠ MATCH_MODEL_VERSION; `checked_at` mais
 * velho que MODEL_SCORELINE_MAX_AGE_MS; ou o jogo já começou. Nunca lança.
 */
export async function getMatchModelScoreline(
  matchId: string,
  now: Date = new Date(),
): Promise<ModelScoreline | null> {
  try {
    const found = await getLatestMatchModelSnapshotWithKickoff(matchId);
    if (!found) return null;
    const { snapshot, kickoffAt } = found;
    if (snapshot.modelVersion !== MATCH_MODEL_VERSION) return null;
    if (now.getTime() - snapshot.checkedAt.getTime() > MODEL_SCORELINE_MAX_AGE_MS) {
      return null;
    }
    if (kickoffAt.getTime() <= now.getTime()) return null;
    const { lambdaHome, lambdaAway, rho } = snapshot;
    return {
      source: snapshot.lambdaSource,
      degraded: snapshot.lambdaDegraded,
      lambdaHome,
      lambdaAway,
      ...(rho === null ? {} : { rho }),
      matrix: scorelineMatrix(
        lambdaHome,
        lambdaAway,
        rho === null ? undefined : { rho },
      ),
      ...(snapshot.lambdaFallbackReason
        ? { fallbackReason: snapshot.lambdaFallbackReason }
        : {}),
      baseCheckedAt: snapshot.checkedAt,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "model_base",
        error: "model_scoreline_read_failed",
        matchId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}
