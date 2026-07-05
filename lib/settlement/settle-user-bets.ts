import type { PalpiteResultData } from "@/db/schema";
import {
  getPendingUserBetLegSettlements,
  insertBetLegOutcomeIfAbsent,
} from "@/lib/db/queries/user-bets";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureEvents,
  NormalizedFixtureResult,
} from "@/lib/providers/sports-data/types";
import { palpiteResultDataFrom } from "@/lib/settlement/palpite-result-data";
import {
  EVENT_BACKED_USER_BET_KINDS,
  USER_BET_SETTLEMENT_RULES,
} from "@/lib/settlement/rules/user-bet-dispatch";
import { SettlementError } from "@/lib/settlement/schemas";

export type UserBetSettlementSummary = {
  considered: number;
  settled: number; // novas outcome rows escritas
  alreadySettled: number; // no-op idempotente (conflito no re-run)
  skipped: number; // jogo não-finalizado / sem regulationScore
  errors: number; // provider falhou / score malformado / params inválidos
  byResult: { won: number; lost: number };
};

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "settlement_user_bets", event, ...data }));
}

/**
 * Liquida cada perna settleable pendente de aposta livre cujo jogo tem placar de 90'
 * (ADR 0036, Decisão 6). Espelha settlePendingPalpites: próprio pending set, próprio
 * Map de resultado, dispatch por kind (USER_BET_SETTLEMENT_RULES — Fase 1 só
 * exact_score, REUSANDO a regra pura de palpite verbatim). Idempotente
 * (insertBetLegOutcomeIfAbsent + UNIQUE legId), seguro re-rodar. ORTOGONAL a
 * settlePendingPalpites/Predictions (ADR 0028: aposta do usuário é registro Análise).
 * Compare DIRETO sem grade; sem regulationScore (prorrogação/pênaltis, ou jogo não
 * finalizado) → PENDING (prefer-skip); provider que falhou → errors.
 */
export async function settleUserBetLegs(
  now: Date = new Date(),
): Promise<UserBetSettlementSummary> {
  const pending = await getPendingUserBetLegSettlements(now);
  const summary: UserBetSettlementSummary = {
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

  // Resolve cada jogo distinto 1x. TRÊS estados (undefined = não tentado; null =
  // provider falhou → errors; objeto = avaliado no loop). Espelha settle-palpites.
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

  // Fetch extra de /fixtures/events SÓ pros matches com ≥1 perna event-backed
  // pendente (first_to_score) — espelha settle-palpites. Erro/Unsupported → null → a
  // regra trata como eventos ausentes → PENDING (nunca erra o match inteiro).
  const eventsByMatch = new Map<
    string,
    NormalizedFixtureEvents | undefined | null
  >();
  for (const p of pending) {
    if (!EVENT_BACKED_USER_BET_KINDS.has(p.kind)) continue;
    if (eventsByMatch.has(p.matchId)) continue;
    const ref: FixtureRef = {
      league: p.league,
      kickoffAt: p.kickoffAt.toISOString(),
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
    };
    try {
      eventsByMatch.set(p.matchId, await provider.getFixtureEvents(ref));
    } catch (err) {
      log("provider_error", {
        matchId: p.matchId,
        method: "getFixtureEvents",
        message: err instanceof Error ? err.message : String(err),
      });
      eventsByMatch.set(p.matchId, null);
    }
  }

  for (const p of pending) {
    const result = resultByMatch.get(p.matchId);
    if (result === null) {
      summary.errors += 1;
      continue;
    }
    // Só liquida num placar de 90' finalizado. Compare usa SÓ regulationScore (90',
    // nunca ET/pênaltis): jogo decidido na prorrogação com regulationScore null fica
    // PENDING, nunca liquida pelo placar de ET.
    if (!result || result.status !== "finished" || !result.regulationScore) {
      summary.skipped += 1;
      continue;
    }

    let outcome: "won" | "lost";
    let resultData: PalpiteResultData;
    try {
      // NARROW-not-cast (gate na query já garante): kind sem regra → PENDING.
      const rule = USER_BET_SETTLEMENT_RULES[p.kind];
      if (rule === undefined) {
        throw new SettlementError("no settlement rule for bet leg kind", {
          kind: p.kind,
        });
      }
      const events = EVENT_BACKED_USER_BET_KINDS.has(p.kind)
        ? eventsByMatch.get(p.matchId) ?? undefined
        : undefined;
      resultData = palpiteResultDataFrom(result.regulationScore, {
        halftimeScore: result.halftimeScore ?? null,
        events: events ?? undefined,
      });
      outcome = rule(p.params, resultData);
    } catch (err) {
      const ctx = err instanceof SettlementError ? err.context : undefined;
      summary.errors += 1;
      log("settle_compute_error", {
        legId: p.legId,
        message: err instanceof Error ? err.message : String(err),
        context: ctx,
      });
      continue;
    }

    const inserted = await insertBetLegOutcomeIfAbsent({
      legId: p.legId,
      resultData,
      result: outcome,
    });
    if (inserted) {
      summary.settled += 1;
      summary.byResult[outcome] += 1;
      log("settled", {
        legId: p.legId,
        matchId: p.matchId,
        kind: p.kind,
        result: outcome,
      });
    } else {
      summary.alreadySettled += 1;
    }
  }

  log("done", { ...summary });
  return summary;
}
