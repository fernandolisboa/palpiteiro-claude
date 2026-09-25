import {
  ANALYSIS_ENGINES,
  isAnalysisEngine,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

import { computeCalibration, type CalibrationSummary } from "./metrics";

// Agrega os pares de calibração por versão (Report 03 rec. 3) e por motor (ADR 0041
// §5, #513). Puro — recebe as rows da query, devolve modelo vs mercado por grupo.
// skill = o modelo bater o mercado no-vig (log-loss/Brier menores). O grupo
// "(todas as versões)" dá o retrato agregado; os por-versão mostram se um bump de
// prompt (llm) ou de λ/pesos (code_jev) melhorou a calibração.

export type CalibrationGroup = {
  // Versão que produziu o NÚMERO: promptVersion no llm; as tags do motor
  // (lambda/judg/w) no code_jev — lá o promptVersion é o do narrador, que só narra.
  version: string;
  n: number;
  model: CalibrationSummary;
  market: CalibrationSummary;
  // >0 ⇒ o modelo bate o mercado (log-loss/Brier do modelo MENORES que os do mercado).
  logLossSkill: number;
  brierSkill: number;
};

export function calibrationVersionOf(r: OverUnderCalibrationRow): string {
  return r.engine === "code_jev" && r.engineConfig
    ? r.engineConfig
    : r.promptVersion;
}

function groupFor(
  version: string,
  rows: OverUnderCalibrationRow[],
): CalibrationGroup {
  const model = computeCalibration(
    rows.map((r) => ({ p: r.modelPOver, y: r.overHappened })),
  );
  const market = computeCalibration(
    rows.map((r) => ({ p: r.marketPOver, y: r.overHappened })),
  );
  return {
    version,
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
    const key = calibrationVersionOf(r);
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const byVersion = [...buckets.entries()]
    .map(([version, rs]) => groupFor(version, rs))
    // Mais amostras primeiro; empate desce pra versão (desc — a mais nova no topo).
    .sort((a, b) => b.n - a.n || b.version.localeCompare(a.version));
  return {
    overall: rows.length ? groupFor("(todas as versões)", rows) : null,
    byVersion,
  };
}

// ── Segmentação por motor (ADR 0041 §5/§7, #513) ────────────────────────────

/** Recorte da página: todos os motores ou um só. */
export type EngineSegment = "all" | AnalysisEngine;

/** `?engine=` da URL → recorte. Qualquer valor fora do enum cai em "all". */
export function parseEngineSegment(v: unknown): EngineSegment {
  return isAnalysisEngine(v) ? v : "all";
}

export function filterByEngineSegment(
  rows: OverUnderCalibrationRow[],
  segment: EngineSegment,
): OverUnderCalibrationRow[] {
  return segment === "all" ? rows : rows.filter((r) => r.engine === segment);
}

export type EngineCalibration = {
  engine: AnalysisEngine;
  bets: number; // recomendações de aposta (o resto é pass)
  group: CalibrationGroup | null; // null = sem amostra desse motor ainda
};

/**
 * Uma linha por motor, SEMPRE nos dois (ordem de ANALYSIS_ENGINES) — o motor sem
 * amostra aparece com group=null, pra comparação lado a lado ficar explícita.
 * `unattributed` conta rows com tag de motor desconhecida (fora dos segmentos,
 * mas dentro do agregado).
 */
export function deriveCalibrationByEngine(rows: OverUnderCalibrationRow[]): {
  engines: EngineCalibration[];
  unattributed: number;
} {
  const engines = ANALYSIS_ENGINES.map((engine) => {
    const rs = rows.filter((r) => r.engine === engine);
    return {
      engine,
      bets: rs.filter((r) => r.isBet).length,
      group: rs.length ? groupFor(engine, rs) : null,
    };
  });
  return {
    engines,
    unattributed: rows.filter((r) => r.engine === null).length,
  };
}
