import { getPendingPalpiteSettlements } from "@/lib/db/queries/palpites";
import { insertPalpiteOutcomeIfAbsent } from "@/lib/db/queries/palpite-outcomes";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
} from "@/lib/providers/sports-data/types";
import { settleExactScorePalpite } from "@/lib/settlement/rules/exact_score_palpite";
import {
  resultDataFromRegulationScore,
  SettlementError,
} from "@/lib/settlement/schemas";

export type PalpiteSettlementSummary = {
  considered: number;
  settled: number; // novas outcome rows escritas
  alreadySettled: number; // no-op idempotente (conflito no re-run)
  skipped: number; // jogo não-finalizado / sem regulationScore
  errors: number; // provider falhou / score malformado / params inválidos
  byResult: { won: number; lost: number };
};

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "settlement_palpites", event, ...data }));
}

/**
 * Liquida cada palpite de placar exato pendente cujo jogo tem um placar de 90'.
 * Idempotente (insertPalpiteOutcomeIfAbsent + UNIQUE palpiteId), seguro re-rodar.
 * ORTOGONAL a settlePendingPredictions: próprio pending set, próprio Map de
 * resultados, sem tocar o loop de predictions (ADR 0028). Reusa o MESMO provider
 * singleton (getSportsDataProvider) — o provider cacheia por FixtureRef, sem
 * pressão extra de quota.
 *
 * Compare DIRETO sem grade (settleExactScorePalpite): um 4-1 liquida normalmente.
 * Jogos adiados/cancelados/não-finalizados ou sem regulationScore ficam PENDING
 * (skipped); provider que falhou → errors (prefer skip over silent wrong settle).
 */
export async function settlePendingPalpites(
  now: Date = new Date()
): Promise<PalpiteSettlementSummary> {
  const pending = await getPendingPalpiteSettlements(now);
  const summary: PalpiteSettlementSummary = {
    considered: pending.length,
    settled: 0,
    alreadySettled: 0,
    skipped: 0,
    errors: 0,
    byResult: { won: 0, lost: 0 },
  };
  if (pending.length === 0) {
    log("noop", { reason: "no_pending" });
    return summary;
  }

  const provider = getSportsDataProvider();

  // Resolve cada jogo distinto 1x. TRÊS estados (NÃO colapsar undefined e null):
  // undefined = lookup ainda não tentado (chave ausente do Map); null = provider
  // tentou e falhou → bucketa em errors; objeto presente mas !finished/
  // !regulationScore → skipped (avaliado no loop abaixo).
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
    // Só liquida num placar de 90' finalizado. postponed/cancelled/live/scheduled
    // ou fixture ausente → deixa PENDING. O compare usa SÓ regulationScore (90',
    // nunca ET/pênaltis) — um jogo decidido na prorrogação com regulationScore
    // null cai aqui e fica pending, NUNCA liquida pelo placar de ET.
    if (!result || result.status !== "finished" || !result.regulationScore) {
      summary.skipped += 1;
      continue;
    }

    // resultData (do regulationScore ao vivo) e o compare ficam DENTRO do try:
    // uma row ruim (score 90' não-inteiro, params inválidos) bucketa em errors e
    // os irmãos do mesmo batch ainda liquidam — nunca aborta o loop.
    let result_: "won" | "lost";
    let resultData;
    try {
      resultData = resultDataFromRegulationScore(result.regulationScore);
      result_ = settleExactScorePalpite(p.params, resultData);
    } catch (err) {
      const ctx = err instanceof SettlementError ? err.context : undefined;
      summary.errors += 1;
      log("settle_compute_error", {
        palpiteId: p.palpiteId,
        message: err instanceof Error ? err.message : String(err),
        context: ctx,
      });
      continue;
    }

    const inserted = await insertPalpiteOutcomeIfAbsent({
      palpiteId: p.palpiteId,
      resultData,
      result: result_,
    });
    if (inserted) {
      summary.settled += 1;
      summary.byResult[result_] += 1;
      log("settled", {
        palpiteId: p.palpiteId,
        matchId: p.matchId,
        result: result_,
        totalGoals: resultData.totalGoals,
      });
    } else {
      summary.alreadySettled += 1;
    }
  }

  log("done", { ...summary });
  return summary;
}
