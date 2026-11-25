import { getEnableClvCapture } from "@/lib/db/queries/ai-config";
import { getNonPassPredictionsNearKickoff } from "@/lib/db/queries/predictions";
import { CLV_CAPTURE_LOOKAHEAD_MS } from "@/lib/odds/clv-window";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import {
  getDescriptor,
  type MarketDescriptor,
} from "@/lib/odds/market-descriptor";
import { persistOddsApiQuota } from "@/lib/odds/persist-odds-api-quota";
import { getLastOddsApiQuota } from "@/lib/providers/odds-api";
import { hasAnalyzedKickoffBetween } from "@/lib/sync/analyzed-kickoffs";

// Forward-capture da closing line (#180). Nenhum provider dá odds históricas de
// fechamento (ADR 0025): a closing line tem que ser capturada AO VIVO perto do KO. O
// cron capture-closing-odds chama isto a cada 30min. Gated por `enableClvCapture`
// (default OFF → zero quota). Captura SÓ pra jogos com predição non-pass (AC do #180).

export type CaptureClosingLinesSummary = {
  // Portão no KV fechado (#680, ADR 0074): nenhum jogo analisado na janela, a flag nem
  // foi lida (`enabled` false) e o Postgres não foi tocado.
  skipped?: "no_analyzed_kickoff";
  enabled: boolean;
  consideredMatches: number;
  capturedMatches: number;
  skippedNoDescriptor: number;
  errors: number;
  // Crédito mensal da The Odds API após o run (medição de quota — AC). Os logs
  // por-call do quota-logger já trazem a telemetria exata; isto é a linha de summary.
  // `null` = nenhum fetch real neste run (flag OFF, zero candidato, ou TUDO cache-hit
  // — quota só é registrada em call não-cache-hit) → consultar os logs por-call.
  quotaMonthlyRemaining: number | null;
  quotaMonthlyUsed: number | null;
};

/**
 * Captura a closing line dos jogos com KO em ≤90min que têm predição non-pass.
 *
 * SEQUENCIAL de propósito: o gate de frescor de 30min do `ensureOddsSnapshotsFresh`
 * faz o 1º jogo stale de uma liga buscar a liga INTEIRA (featured) e gravar snapshots
 * pra TODOS os jogos da janela; os próximos da mesma liga acham fresco e pulam (0
 * créditos). Paralelo arriscaria 2 jogos stale da mesma liga buscarem antes de
 * qualquer escrita (créditos duplicados). Additional (btts/dupla chance) é por evento
 * (1 crédito/jogo), correto por-jogo. Pass nunca chega aqui (filtro na query).
 */
export async function captureClosingLines(
  opts: { now?: Date } = {},
): Promise<CaptureClosingLinesSummary> {
  const now = opts.now ?? new Date();

  // Portão no KV (#680, ADR 0074) antes da flag: a flag mora no Postgres, e lê-la a
  // cada 30 min mantinha o Neon acordado. Sem jogo analisado com KO na janela → sai
  // calado, sem query. `null` (sem KV, índice sem carimbo) segue o caminho de sempre.
  const gate = await hasAnalyzedKickoffBetween(
    now.getTime(),
    now.getTime() + CLV_CAPTURE_LOOKAHEAD_MS,
  );
  if (gate === false) {
    return {
      skipped: "no_analyzed_kickoff",
      enabled: false,
      consideredMatches: 0,
      capturedMatches: 0,
      skippedNoDescriptor: 0,
      errors: 0,
      quotaMonthlyRemaining: null,
      quotaMonthlyUsed: null,
    };
  }

  if (!(await getEnableClvCapture())) {
    console.log(
      JSON.stringify({ scope: "capture_closing_odds", event: "disabled" }),
    );
    return {
      enabled: false,
      consideredMatches: 0,
      capturedMatches: 0,
      skippedNoDescriptor: 0,
      errors: 0,
      quotaMonthlyRemaining: null,
      quotaMonthlyUsed: null,
    };
  }

  const candidates = await getNonPassPredictionsNearKickoff({
    now,
    lookaheadMs: CLV_CAPTURE_LOOKAHEAD_MS,
  });

  let capturedMatches = 0;
  let skippedNoDescriptor = 0;
  let errors = 0;

  for (const c of candidates) {
    const descriptors: MarketDescriptor[] = c.marketKeys
      .map((k) => getDescriptor(k))
      .filter((d): d is MarketDescriptor => d !== undefined);
    if (descriptors.length === 0) {
      // Sem descriptor (ex.: over/under extra-line via OVER_UNDER_ALT, fora do
      // ALL_DESCRIPTORS) → nada a buscar; o CLV daquela predição fica null (honesto).
      skippedNoDescriptor++;
      continue;
    }
    try {
      await ensureOddsSnapshotsFresh(c.match, { markets: descriptors, now });
      capturedMatches++;
    } catch (err) {
      errors++;
      console.error(
        JSON.stringify({
          scope: "capture_closing_odds",
          event: "match_failed",
          matchId: c.match.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const quota = getLastOddsApiQuota();
  const summary: CaptureClosingLinesSummary = {
    enabled: true,
    consideredMatches: candidates.length,
    capturedMatches,
    skippedNoDescriptor,
    errors,
    quotaMonthlyRemaining: quota?.monthlyRemaining ?? null,
    quotaMonthlyUsed: quota?.monthlyUsed ?? null,
  };
  console.log(
    JSON.stringify({
      scope: "capture_closing_odds",
      event: "run_complete",
      ...summary,
    }),
  );
  // Saldo real pro /admin/leagues (#509). Best-effort, nunca lança.
  await persistOddsApiQuota(quota, "capture_closing_odds");
  return summary;
}
