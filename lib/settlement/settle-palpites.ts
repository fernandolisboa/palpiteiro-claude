import type { PalpiteResultData } from "@/db/schema";
import { getPendingPalpiteSettlements } from "@/lib/db/queries/palpites";
import { insertPalpiteOutcomeIfAbsent } from "@/lib/db/queries/palpite-outcomes";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureEvents,
  NormalizedFixtureResult,
} from "@/lib/providers/sports-data/types";
import { palpiteResultDataFrom } from "@/lib/settlement/palpite-result-data";
import {
  EVENT_BACKED_PALPITE_TYPES,
  PALPITE_SETTLEMENT_RULES,
} from "@/lib/settlement/rules/palpite-dispatch";
import { SettlementError } from "@/lib/settlement/schemas";

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
 * Liquida cada palpite settleable pendente cujo jogo tem um placar de 90'. Dispatch
 * por TIPO (#354) via PALPITE_SETTLEMENT_RULES: exact_score (placar de 90'), margin,
 * clean_sheet (ambos do placar de 90'), first_half_score (split do intervalo) e
 * first_to_score (eventos de gol). Idempotente (insertPalpiteOutcomeIfAbsent + UNIQUE
 * palpiteId), seguro re-rodar. ORTOGONAL a settlePendingPredictions: próprio pending
 * set, próprios Maps de resultado/eventos, sem tocar o loop de predictions (ADR 0028).
 * Reusa o MESMO provider singleton (getSportsDataProvider) — o provider cacheia por
 * FixtureRef.
 *
 * Compare DIRETO sem grade: um 4-1 (exact_score) liquida normalmente. Jogos
 * adiados/cancelados/não-finalizados ou sem regulationScore ficam PENDING (skipped);
 * provider que falhou → errors. Halftime ausente → first_half_score PENDING; eventos
 * ausentes/Unsupported → first_to_score PENDING (prefer skip over silent wrong settle),
 * sem afetar as dimensões irmãs do mesmo jogo.
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

  // Fetch extra de /fixtures/events (#354, espelha settle.ts:127-158): SÓ pros matches
  // com ≥1 row pendente de tipo event-backed (first_to_score). Memoizado per-match.
  // SportsDataUnsupportedError (football-data-org) / erro / não-encontrado → null →
  // a regra trata como eventos ausentes → PENDING (nunca erra o match inteiro nem LOST).
  // Map SEPARADO do eventsByMatch de settle.ts — dedup cross-cron só via inMemoryCache
  // do provider (PLAN §6 landmine #5; ~1 crédito extra/fixture finalizado com row
  // first_to_score no último set, bounded).
  const eventsByMatch = new Map<
    string,
    NormalizedFixtureEvents | undefined | null
  >();
  for (const p of pending) {
    if (!EVENT_BACKED_PALPITE_TYPES.has(p.type)) continue;
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
    // Só liquida num placar de 90' finalizado. postponed/cancelled/live/scheduled
    // ou fixture ausente → deixa PENDING. O compare usa SÓ regulationScore (90',
    // nunca ET/pênaltis) — um jogo decidido na prorrogação com regulationScore
    // null cai aqui e fica pending, NUNCA liquida pelo placar de ET.
    if (!result || result.status !== "finished" || !result.regulationScore) {
      summary.skipped += 1;
      continue;
    }

    // resultData (do regulationScore ao vivo + halftime + eventos quando event-backed)
    // e o compare ficam DENTRO do try: uma row ruim (score 90' não-inteiro, params
    // inválidos, halftime/eventos ausentes) bucketa em errors e os irmãos do mesmo
    // batch ainda liquidam — nunca aborta o loop.
    let result_: "won" | "lost";
    let resultData: PalpiteResultData;
    try {
      // NARROW-not-cast (defense-in-depth, gate na query): a row já é
      // SettleablePalpiteType, mas guardamos o lookup explicitamente — uma row com
      // type fora do registry lança → PENDING (prefer-skip), nunca um lookup undefined.
      if (!(p.type in PALPITE_SETTLEMENT_RULES)) {
        throw new SettlementError("no settlement rule for palpite type", {
          type: p.type,
        });
      }
      const rule = PALPITE_SETTLEMENT_RULES[p.type];
      const events = EVENT_BACKED_PALPITE_TYPES.has(p.type)
        ? eventsByMatch.get(p.matchId) ?? undefined
        : undefined;
      resultData = palpiteResultDataFrom(result.regulationScore, {
        halftimeScore: result.halftimeScore ?? null,
        events: events ?? undefined,
      });
      result_ = rule(p.params, resultData);
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
        type: p.type,
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
