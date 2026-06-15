import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { matches, selectionOddsSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import { CLV_CLOSING_WINDOW_MS } from "@/lib/odds/clv-window";

// Read-time da closing line pro CLV (#180). NÃO há coluna "closing" — a closing line
// é o ÚLTIMO snapshot de `selection_odds_snapshots` da seleção ESCOLHIDA dentro de
// [KO−CLV_CLOSING_WINDOW, KO]. Lê só a row da seleção escolhida (1 row): o
// `overround_pct` dela é do MERCADO COMPLETO por construção (write atômico), então
// serve direto pro CLV no-vig — sem reconstruir o book N-vias.

export type ClosingSnapshotInput = {
  predictionId: string;
  matchId: string;
  marketId: string;
  selectionId: string | null; // NULL em pass → ignorado (sem closing)
  line: number | null; // marketParams.line; null em mercados sem linha
};

export type ClosingSnapshot = {
  oddClose: string; // Drizzle numeric = string; Number() no boundary de cálculo
  overroundPctClose: string;
  bookmaker: string;
  capturedAt: Date;
};

// Chave de match line-aware. Normaliza a linha via Number→String dos dois lados pra
// não depender de formatação (jsonb 2.5 → "2.5"; input 2.5 → "2.5"). null/sem linha → "".
function lineKey(
  matchId: string,
  marketId: string,
  selectionId: string,
  line: number | null,
): string {
  const l = line === null || !Number.isFinite(line) ? "" : String(Number(line));
  return `${matchId}|${marketId}|${selectionId}|${l}`;
}

/**
 * Pra cada predição non-pass de entrada, a closing line (último snapshot da seleção
 * escolhida em [KO−CLV_CLOSING_WINDOW, KO]) ou ausente (sem captura genuína perto do
 * KO → o caller deixa o CLV null). UMA query: filtra a janela por match (join em
 * `matches.kickoff_at`), ORDER BY captured_at DESC, e reduz em JS ao mais recente por
 * (match, market, selection, line) — SEM `DISTINCT ON` em jsonb (inseguro;
 * value-vs-reference). Linha comparada por `market_params->>'line'` (text), espelhando
 * odds-snapshots.ts.
 */
export async function getClosingSnapshotsForPredictions(
  inputs: ClosingSnapshotInput[],
): Promise<Map<string, ClosingSnapshot>> {
  const out = new Map<string, ClosingSnapshot>();
  const valid = inputs.filter(
    (i): i is ClosingSnapshotInput & { selectionId: string } =>
      i.selectionId !== null,
  );
  if (valid.length === 0) return out;

  const matchIds = [...new Set(valid.map((i) => i.matchId))];
  const windowSec = CLV_CLOSING_WINDOW_MS / 1000;

  const rows = await db
    .select({
      matchId: selectionOddsSnapshots.matchId,
      marketId: selectionOddsSnapshots.marketId,
      selectionId: selectionOddsSnapshots.selectionId,
      line: sql<
        string | null
      >`${selectionOddsSnapshots.marketParams}->>'line'`,
      odd: selectionOddsSnapshots.odd,
      overroundPct: selectionOddsSnapshots.overroundPct,
      bookmaker: selectionOddsSnapshots.bookmaker,
      capturedAt: selectionOddsSnapshots.capturedAt,
    })
    .from(selectionOddsSnapshots)
    .innerJoin(matches, eq(matches.id, selectionOddsSnapshots.matchId))
    .where(
      and(
        inArray(selectionOddsSnapshots.matchId, matchIds),
        sql`${selectionOddsSnapshots.capturedAt} <= ${matches.kickoffAt}`,
        sql`${selectionOddsSnapshots.capturedAt} >= ${matches.kickoffAt} - make_interval(secs => ${windowSec})`,
      ),
    )
    .orderBy(desc(selectionOddsSnapshots.capturedAt));

  // Mais recente (1º, pois desc) por (match, market, selection, line).
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = lineKey(
      r.matchId,
      r.marketId,
      r.selectionId,
      r.line === null ? null : Number(r.line),
    );
    if (!latest.has(k)) latest.set(k, r);
  }

  for (const inp of valid) {
    const r = latest.get(
      lineKey(inp.matchId, inp.marketId, inp.selectionId, inp.line),
    );
    if (r) {
      out.set(inp.predictionId, {
        oddClose: r.odd,
        overroundPctClose: r.overroundPct,
        bookmaker: r.bookmaker,
        capturedAt: r.capturedAt,
      });
    }
  }
  return out;
}
