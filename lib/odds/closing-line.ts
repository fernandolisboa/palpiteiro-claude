import { getEnableClvCapture } from "@/lib/db/queries/ai-config";
import { getNonPassPredictionsNearKickoff } from "@/lib/db/queries/predictions";
import { CLV_CAPTURE_LOOKAHEAD_MS } from "@/lib/odds/clv-window";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import {
  getDescriptor,
  type MarketDescriptor,
} from "@/lib/odds/market-descriptor";
import { getLastOddsApiQuota } from "@/lib/providers/odds-api";

// Forward-capture da closing line (#180). Nenhum provider dá odds históricas de
// fechamento (ADR 0025): a closing line tem que ser capturada AO VIVO perto do KO. O
// cron capture-closing-odds chama isto a cada 30min. Gated por `enableClvCapture`
// (default OFF → zero quota). Captura SÓ pra jogos com predição non-pass (AC do #180).

export type CaptureClosingLinesSummary = {
  enabled: boolean;
  consideredMatches: number;
  capturedMatches: number;
  skippedNoDescriptor: number;
  errors: number;
  // Crédito mensal da The Odds API após o run (medição de quota — AC). Os logs
  // por-call do quota-logger já trazem a telemetria exata; isto é a linha de summary.
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
  return summary;
}
