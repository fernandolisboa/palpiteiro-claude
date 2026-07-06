import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

import { computeCalibration, type CalibrationSummary } from "./metrics";

// Agrega os pares de calibração por versão de prompt (Report 03 rec. 3). Puro — recebe
// as rows da query, devolve modelo vs mercado por grupo. skill = o modelo bater o
// mercado no-vig (log-loss/Brier menores). O grupo "(todas as versões)" dá o retrato
// agregado; os por-versão mostram se um bump de prompt melhorou a calibração.

export type CalibrationGroup = {
  promptVersion: string;
  n: number;
  model: CalibrationSummary;
  market: CalibrationSummary;
  // >0 ⇒ o modelo bate o mercado (log-loss/Brier do modelo MENORES que os do mercado).
  logLossSkill: number;
  brierSkill: number;
};

function groupFor(
  promptVersion: string,
  rows: OverUnderCalibrationRow[],
): CalibrationGroup {
  const model = computeCalibration(
    rows.map((r) => ({ p: r.modelPOver, y: r.overHappened })),
  );
  const market = computeCalibration(
    rows.map((r) => ({ p: r.marketPOver, y: r.overHappened })),
  );
  return {
    promptVersion,
    n: rows.length,
    model,
    market,
    logLossSkill: market.logLoss - model.logLoss,
    brierSkill: market.brier - model.brier,
  };
}

export function deriveCalibration(rows: OverUnderCalibrationRow[]): {
  overall: CalibrationGroup | null;
  byVersion: CalibrationGroup[];
} {
  const buckets = new Map<string, OverUnderCalibrationRow[]>();
  for (const r of rows) {
    const list = buckets.get(r.promptVersion) ?? [];
    list.push(r);
    buckets.set(r.promptVersion, list);
  }
  const byVersion = [...buckets.entries()]
    .map(([version, rs]) => groupFor(version, rs))
    // Mais amostras primeiro; empate desce pra versão (desc — a mais nova no topo).
    .sort((a, b) => b.n - a.n || b.promptVersion.localeCompare(a.promptVersion));
  return {
    overall: rows.length ? groupFor("(todas as versões)", rows) : null,
    byVersion,
  };
}
