import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureEvents,
  NormalizedFixtureResult,
} from "@/lib/providers/sports-data/types";
import { getPendingSettlementPredictions } from "@/lib/db/queries/predictions";
import { insertOutcomeIfAbsent } from "@/lib/db/queries/prediction-outcomes";
import {
  computeSettlement,
  type OutcomeResult,
  type Settlement,
} from "@/lib/settlement/compute";
import {
  resultDataFromRegulationScore,
  SettlementError,
  type ResultData,
  type ResultScorer,
} from "@/lib/settlement/schemas";

// rule_keys que exigem o fetch extra de /fixtures/events (#290). Data-driven (não
// `if (market === X)` fora deste set): uma predição pendente com rule_key aqui
// dispara o 2º fetch per-match; matches só-partition mantêm SÓ getFixtureResult
// (byte-idêntico, sem egress extra).
const EVENT_BACKED_RULE_KEYS = new Set(["anytime_scorer", "assist"]);

export type SettlementSummary = {
  considered: number;
  settled: number; // newly written outcome rows
  alreadySettled: number; // idempotent no-op (conflict on re-run)
  skipped: number; // match not final, or non-pass bet missing entry odd
  errors: number; // provider lookup failed OR a per-row settlement computation threw
  byResult: Record<OutcomeResult, number>;
};

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "settlement", event, ...data }));
}

// Spread (SEM re-parse, C8) dos artilheiros/assistentes de 90' creditados + o flag
// eventsAvailable sobre o resultData base. Filtra REGULATION-90 + EXCLUI own goals
// (regra de mercado: artilheiro é quem marca a favor). `events` undefined (fetch
// falhou/não-encontrado) → eventsAvailable=false → a regra deixa PENDING (nunca
// fabrica loss). Devolve um NOVO objeto contendo as chaves scorer (persistido
// verbatim por insertOutcomeIfAbsent → round-trip preservado).
function mergeFixtureEvents(
  base: ResultData,
  events: NormalizedFixtureEvents | undefined,
): ResultData {
  if (!events || events.eventsAvailable !== true) {
    return { ...base, eventsAvailable: false };
  }
  // Guarda de consistência (prefer-skip sobre silent-wrong-settle): o fio
  // /fixtures/events pode atrasar/voltar [] num jogo finalizado. Se o placar de 90'
  // tem gols mas a lista de gols de REGULAÇÃO (own goals INCLUSOS — contam pro placar)
  // veio VAZIA, o feed está incompleto → deixa PENDING em vez de fabricar LOSTs (um
  // 3-1 finalizado com feed vazio settlaria todo mundo como LOST sem esta guarda). O
  // 0-0 legítimo (totalGoals=0, lista vazia) passa e settla certo. Gaps PARCIAIS
  // (feed com menos gols que o placar) ficam como risco residual até o fio ser
  // verificado ao vivo (ADR 0025 manda inspecionar o 1º payload real) — não dá pra
  // distinguir gap de discrepância benigna no fio não-verificado sem over-pending.
  const regulationGoalCount = events.goals.filter((g) => g.isRegulation).length;
  if (base.totalGoals > 0 && regulationGoalCount === 0) {
    return { ...base, eventsAvailable: false };
  }
  const scorers: ResultScorer[] = events.goals
    .filter((g) => g.isRegulation && !g.isOwnGoal)
    .map((g) => ({ playerId: g.playerId, canonicalName: g.playerName }));
  const assisters: ResultScorer[] = events.assists
    .filter((a) => a.isRegulation)
    .map((a) => ({ playerId: a.playerId, canonicalName: a.playerName }));
  return { ...base, eventsAvailable: true, scorers, assisters };
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
    byResult: { won: 0, lost: 0, void: 0, push: 0 },
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

  // Fetch extra de /fixtures/events (#290): SÓ pros matches com ≥1 predição
  // pendente de scorer/assist. Memoizado per-match. undefined = fetch falhou ou
  // não-encontrado → a regra de settlement deixa PENDING (eventsAvailable !== true).
  const eventsByMatch = new Map<
    string,
    NormalizedFixtureEvents | undefined | null
  >();
  for (const p of pending) {
    if (
      p.settlementRuleKey === null ||
      !EVENT_BACKED_RULE_KEYS.has(p.settlementRuleKey)
    ) {
      continue;
    }
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
    // Only settle on a finished 90' score. postponed/cancelled/live/scheduled
    // or a missing fixture → leave pending (may reschedule or resolve later).
    if (!result || result.status !== "finished" || !result.regulationScore) {
      summary.skipped += 1;
      continue;
    }

    // A construção do result_data (Zod, sobre o regulationScore ao vivo — o fato
    // canônico, split sempre confiável) e o computeSettlement ficam DENTRO do try
    // (I4): uma row ruim — score 90' não-inteiro, params/rule_key inválidos —
    // bucketa em errors e os irmãos do mesmo batch ainda liquidam, nunca aborta.
    let resultData: ResultData;
    let settlement: Settlement | null;
    try {
      resultData = resultDataFromRegulationScore(result.regulationScore);
      // #290: pra predições event-backed (scorer/assist), MERGE os artilheiros/
      // assistentes + eventsAvailable no MESMO objeto resultData via SPREAD (C8:
      // NUNCA re-parsear o objeto merged contra um sub-schema — z.object faria
      // strip e os scorers sumiriam → PENDING eterno). O objeto entregue a
      // computeSettlement E a insertOutcomeIfAbsent é o MESMO e contém as chaves.
      if (
        p.settlementRuleKey !== null &&
        EVENT_BACKED_RULE_KEYS.has(p.settlementRuleKey)
      ) {
        const events = eventsByMatch.get(p.matchId);
        resultData = mergeFixtureEvents(resultData, events ?? undefined);
      }
      settlement = computeSettlement({
        recommendation: p.recommendation,
        settlementRuleKey: p.settlementRuleKey,
        selectionKey: p.selectionKey,
        marketParams: p.marketParams,
        oddAtRecommendation:
          p.oddAtRecommendation !== null
            ? Number(p.oddAtRecommendation)
            : null,
        stakeUnits: Number(p.stakeUnits),
        resultData,
      });
    } catch (err) {
      // I4: uma row ruim (score malformado, params inválidos, rule_key
      // desconhecido) bucketa em errors e os irmãos do batch ainda liquidam.
      const ctx = err instanceof SettlementError ? err.context : undefined;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors += 1;
      log("settle_compute_error", {
        predictionId: p.predictionId,
        message,
        context: ctx,
      });
      continue;
    }
    if (settlement === null) {
      // Non-pass bet with no entry odd, or a row with no market/selection to
      // dispatch: can't compute profit, leave pending.
      log("skip_no_entry_odd", { predictionId: p.predictionId });
      summary.skipped += 1;
      continue;
    }

    const inserted = await insertOutcomeIfAbsent({
      predictionId: p.predictionId,
      resultData,
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
        totalGoals: resultData.totalGoals,
        profitUnits: settlement.profitUnits,
      });
    } else {
      summary.alreadySettled += 1;
    }
  }

  log("done", { ...summary });
  return summary;
}
