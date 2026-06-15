import { keepLatestPerMatch, type DashboardRow } from "@/lib/dashboard/kpis";
import {
  getClosingSnapshotsForPredictions,
  type ClosingSnapshotInput,
} from "@/lib/db/queries/clv-snapshots";

/**
 * Anexa a closing line (CLV, #180) às rows do dashboard. Busca SÓ pras rows que o
 * dashboard de fato conta — deduped por (jogo, mercado) (ADR 0020) e non-pass — numa
 * única query. As rows do conjunto cheio recebem closingOdd/closingOverroundPct
 * quando há captura na janela [KO−40min, KO]; o resto fica null (CLV null = honesto,
 * sem closing genuíno perto do KO). `deriveDashboardView` re-deduplica idempotente.
 *
 * Async + fora do `deriveDashboardView` (que é puro/sync): o enrich roda na page,
 * antes de derivar a view.
 */
export async function enrichDashboardRowsWithClosing(
  rows: DashboardRow[],
): Promise<DashboardRow[]> {
  const deduped = keepLatestPerMatch(rows);
  const inputs: ClosingSnapshotInput[] = deduped
    .filter(
      (r): r is DashboardRow & { marketId: string; selectionId: string } =>
        r.recommendation !== "pass" &&
        r.selectionId !== null &&
        r.marketId !== null,
    )
    .map((r) => ({
      predictionId: r.predictionId,
      matchId: r.matchId,
      marketId: r.marketId,
      selectionId: r.selectionId,
      line: r.marketParams?.line ?? null,
    }));
  if (inputs.length === 0) return rows;

  const closing = await getClosingSnapshotsForPredictions(inputs);
  if (closing.size === 0) return rows;

  return rows.map((r) => {
    const c = closing.get(r.predictionId);
    return c
      ? {
          ...r,
          closingOdd: c.oddClose,
          closingOverroundPct: c.overroundPctClose,
        }
      : r;
  });
}
