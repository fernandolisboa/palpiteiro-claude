import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

import { MATCH_MODEL_MAX_AGE_MS, MATCH_MODEL_VERSION } from "./version";

// Seam da Fase 2 (cupom, #555/ADR 0052): o modelo de placar do jogo lido da base, sem
// buscar tabela nem ratings. A ligação ao confirmBet (app/actions/bets.ts) fica pra fase
// do cupom; até lá ninguém em produção chama isto.

export const MODEL_SCORELINE_MAX_AGE_MS = MATCH_MODEL_MAX_AGE_MS;

/**
 * O MESMO ModelScoreline de getModelScoreline (lib/quant/match-model.ts), lido da última
 * base do jogo: source = lambda_source, degraded = lambda_degraded, λ = o AJUSTADO
 * (pós-JEV quando aplicado), rho/fallbackReason ausentes quando null, matriz refeita com
 * o mesmo λ/ρ. null quando: sem base; versão ≠ MATCH_MODEL_VERSION; `checked_at` mais
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
