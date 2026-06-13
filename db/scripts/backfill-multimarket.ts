import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { and, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import {
  marketSelections,
  markets,
  matchOddsSnapshots,
  matches,
  predictionOutcomes,
  predictionSelectionOdds,
  predictions,
  selectionOddsSnapshots,
} from "../schema";
import {
  buildResultData,
  frozenPairToSelectionOdds,
  recommendationToSelectionKey,
  snapshotToSelectionRows,
  type SelectionKey,
} from "./backfill-mappings";

/**
 * Backfill DETERMINÍSTICO do histórico over/under no schema multi-mercado (#162).
 * Sem LLM, sem heurística: aponta toda predição histórica pro mercado `over_under`,
 * deriva a seleção da `recommendation`, congela as odds por seleção a partir do par
 * legado e materializa `result_data`/`selection_odds_snapshots`.
 *
 * IMUTABILIDADE: NUNCA toca profit_units/result/stake_units/total_goals/
 * recommendation/market(enum). Só escreve nas colunas/tabelas NOVAS (todas nullable).
 * Logo o dashboard mostra exatamente os mesmos números antes/depois (prova de
 * paridade via db/scripts/dashboard-kpis-snapshot.ts — ver runbook no PR).
 *
 * IDEMPOTENTE: cada passo filtra por `IS NULL` ou usa `ON CONFLICT DO NOTHING`, então
 * uma 2ª execução é no-op. neon-http NÃO tem transação (db.transaction lança) — a
 * segurança vem da idempotência por-statement, não de atomicidade.
 *
 * Uso:
 *   pnpm tsx db/scripts/backfill-multimarket.ts            # DRY-RUN (não escreve)
 *   pnpm tsx db/scripts/backfill-multimarket.ts --apply    # aplica
 */

const APPLY = process.argv.includes("--apply");

function log(msg: string): void {
  console.log(msg);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — create .env.local from .env.example");
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { casing: "snake_case" });

  log(APPLY ? "▶ backfill multi-mercado — APPLY" : "▶ backfill multi-mercado — DRY-RUN (nada é escrito)");

  // ── Passo 0: resolver o catálogo over_under (seedado na migration 0009) ──────
  const [mkt] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.key, "over_under"));
  if (!mkt) {
    throw new Error("mercado 'over_under' não encontrado — a migration 0009 (seed) foi aplicada?");
  }
  const sels = await db
    .select({ id: marketSelections.id, key: marketSelections.key })
    .from(marketSelections)
    .where(eq(marketSelections.marketId, mkt.id));
  const selId = new Map<string, string>(sels.map((s) => [s.key, s.id]));
  const selIdOf = (k: SelectionKey): string => {
    const id = selId.get(k);
    if (!id) throw new Error(`seleção '${k}' não seedada pro over_under`);
    return id;
  };

  // ── Passo 1: predictions → market_id / market_params / selection_id ──────────
  const [pendingPreds] = await db
    .select({ c: count() })
    .from(predictions)
    .where(isNull(predictions.marketId));
  log(`\n[1] predictions sem market_id: ${pendingPreds.c}`);
  // CRASH-IDEMPOTÊNCIA: cada UPDATE roda INCONDICIONALMENTE em APPLY, auto-guardado
  // por IS NULL — NÃO pode ficar atrás de `pendingPreds.c > 0`. neon-http não tem
  // transação; se o UPDATE de market_id passar mas o processo morrer antes do loop de
  // selection_id, a contagem de market_id zera e uma 2ª run PULARIA o selection_id,
  // deixando rows não-pass com selection_id NULL pra sempre. Com guards independentes,
  // a 2ª run cura o que faltou.
  if (APPLY) {
    // market_id + market_params: mesmo valor pra TODA row pendente (inclusive pass).
    await db
      .update(predictions)
      .set({ marketId: mkt.id, marketParams: { line: 2.5 } })
      .where(isNull(predictions.marketId));
    // selection_id por recommendation, derivado da função pura (pass fica NULL —
    // nunca entra nos UPDATEs abaixo). Idempotente via selection_id IS NULL.
    for (const rec of ["over", "under"] as const) {
      const key = recommendationToSelectionKey(rec);
      if (!key) continue;
      await db
        .update(predictions)
        .set({ selectionId: selIdOf(key) })
        .where(
          and(
            eq(predictions.recommendation, rec),
            eq(predictions.marketId, mkt.id),
            isNull(predictions.selectionId),
          ),
        );
    }
    log("    ✓ market_id/market_params/selection_id preenchidos");
  }

  // ── Passo 2: prediction_selection_odds ← par congelado over/under ────────────
  const predsWithPair = await db
    .select({
      id: predictions.id,
      overOdd: predictions.overOddAtPrediction,
      underOdd: predictions.underOddAtPrediction,
    })
    .from(predictions)
    .where(
      and(
        isNotNull(predictions.overOddAtPrediction),
        isNotNull(predictions.underOddAtPrediction),
      ),
    );
  const psoRows = predsWithPair.flatMap((p) =>
    frozenPairToSelectionOdds(p.overOdd, p.underOdd).map((r) => ({
      predictionId: p.id,
      selectionId: selIdOf(r.selectionKey),
      odd: r.odd,
    })),
  );
  log(
    `[2] predictions com par congelado: ${predsWithPair.length} → ${psoRows.length} rows (esperado 2x)`,
  );
  if (APPLY && psoRows.length > 0) {
    await db
      .insert(predictionSelectionOdds)
      .values(psoRows)
      .onConflictDoNothing({
        target: [
          predictionSelectionOdds.predictionId,
          predictionSelectionOdds.selectionId,
        ],
      });
    log("    ✓ prediction_selection_odds inseridas (idempotente)");
  }

  // ── Passo 3: prediction_outcomes.result_data ────────────────────────────────
  const outcomesToFill = await db
    .select({
      predictionId: predictionOutcomes.predictionId,
      totalGoals: predictionOutcomes.totalGoals,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
    })
    .from(predictionOutcomes)
    .innerJoin(predictions, eq(predictionOutcomes.predictionId, predictions.id))
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .where(isNull(predictionOutcomes.resultData));
  const withSplit = outcomesToFill.filter(
    (o) =>
      buildResultData(o.homeScore, o.awayScore, o.totalGoals).homeScore !== null,
  ).length;
  log(
    `[3] outcomes sem result_data: ${outcomesToFill.length} (${withSplit} com split confiável, ${outcomesToFill.length - withSplit} só total)`,
  );
  if (APPLY) {
    for (const o of outcomesToFill) {
      const rd = buildResultData(o.homeScore, o.awayScore, o.totalGoals);
      await db
        .update(predictionOutcomes)
        .set({ resultData: rd })
        .where(
          and(
            eq(predictionOutcomes.predictionId, o.predictionId),
            isNull(predictionOutcomes.resultData),
          ),
        );
    }
    if (outcomesToFill.length > 0) log("    ✓ result_data preenchido (total verbatim; split só se bater)");
  }

  // ── Passo 4: selection_odds_snapshots ← match_odds_snapshots (1 → 2 rows) ────
  const snaps = await db
    .select({
      matchId: matchOddsSnapshots.matchId,
      bookmaker: matchOddsSnapshots.bookmaker,
      line: matchOddsSnapshots.line,
      overOdd: matchOddsSnapshots.overOdd,
      underOdd: matchOddsSnapshots.underOdd,
      overroundPct: matchOddsSnapshots.overroundPct,
      capturedAt: matchOddsSnapshots.capturedAt,
    })
    .from(matchOddsSnapshots);
  const sosRows = snaps.flatMap((s) =>
    snapshotToSelectionRows(s).map((r) => ({
      matchId: s.matchId,
      marketId: mkt.id,
      selectionId: selIdOf(r.selectionKey),
      bookmaker: s.bookmaker,
      marketParams: { line: r.line },
      odd: r.odd,
      overroundPct: s.overroundPct,
      capturedAt: s.capturedAt,
    })),
  );
  // Detecta colisões na chave de dedup (match,bookmaker,captured_at): se houver, o
  // ON CONFLICT colapsaria rows e a contagem ficaria < 2x — NÃO falhar em silêncio.
  const dedupKeys = new Set(snaps.map((s) => `${s.matchId}|${s.bookmaker}|${s.capturedAt.toISOString()}`));
  const collisions = snaps.length - dedupKeys.size;
  log(
    `[4] match_odds_snapshots: ${snaps.length} → ${sosRows.length} selection rows (esperado 2x)` +
      (collisions > 0 ? ` ⚠ ${collisions} colisão(ões) na chave (match,bookmaker,captured_at) — contagem final pode ficar < 2x` : ""),
  );
  if (APPLY && sosRows.length > 0) {
    await db
      .insert(selectionOddsSnapshots)
      .values(sosRows)
      .onConflictDoNothing({
        target: [
          selectionOddsSnapshots.matchId,
          selectionOddsSnapshots.marketId,
          selectionOddsSnapshots.selectionId,
          selectionOddsSnapshots.capturedAt,
          selectionOddsSnapshots.bookmaker,
        ],
      });
    log("    ✓ selection_odds_snapshots inseridas (idempotente)");
  }

  // ── Verificação final (só faz sentido em APPLY) — HARD-FAIL se algo divergir ─
  if (APPLY) {
    const [[mosCount], [sosCount], [predsNullMkt], [nonPassNullSel]] =
      await Promise.all([
        db.select({ c: count() }).from(matchOddsSnapshots),
        db.select({ c: count() }).from(selectionOddsSnapshots),
        db.select({ c: count() }).from(predictions).where(isNull(predictions.marketId)),
        db
          .select({ c: count() })
          .from(predictions)
          .where(
            and(
              ne(predictions.recommendation, "pass"),
              isNull(predictions.selectionId),
            ),
          ),
      ]);
    const countOk = sosCount.c === 2 * mosCount.c;
    log("\n── verificação ──");
    log(`  predictions sem market_id (deve ser 0): ${predsNullMkt.c}`);
    log(`  predictions não-pass sem selection_id (deve ser 0): ${nonPassNullSel.c}`);
    log(
      `  selection_odds_snapshots = ${sosCount.c} vs 2× match_odds_snapshots = ${2 * mosCount.c} → ${countOk ? "OK ✓" : "DIVERGE ⚠"}`,
    );
    if (predsNullMkt.c !== 0 || nonPassNullSel.c !== 0 || !countOk) {
      throw new Error(
        "verificação do backfill FALHOU (ver diagnóstico acima). O backfill é idempotente — investigue e re-rode; não confie nos números até a verificação passar.",
      );
    }
  }

  log(
    APPLY
      ? "\n✓ backfill aplicado. Rode dashboard-kpis-snapshot.ts antes/depois e compare 1:1."
      : "\n(dry-run) nada foi escrito. Rode de novo com --apply para aplicar.",
  );
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
