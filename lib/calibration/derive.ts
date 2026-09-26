import {
  ANALYSIS_ENGINES,
  isAnalysisEngine,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
import type { MarketCalibrationRow } from "@/lib/db/queries/calibration";

import {
  CALIBRATED_MARKETS,
  MULTICLASS_LOG_LOSS,
  type CalibratedMarketKey,
} from "./markets";
import {
  computeCalibration,
  logLoss,
  type CalibrationPair,
  type CalibrationSummary,
} from "./metrics";

// Agrega os pares de calibração por mercado (#453), por versão (Report 03 rec. 3) e
// por motor (ADR 0041 §5, #513). Puro — recebe as rows da query, devolve modelo vs
// mercado por grupo. Misturar mercados num grupo não faz sentido (bins e slope de
// eventos diferentes): a página recorta por mercado ANTES de agregar.
// skill = o modelo bater o mercado no-vig (log-loss/Brier menores). O grupo
// "(todas as versões)" dá o retrato agregado; os por-versão mostram se um bump de
// prompt (llm) ou de λ/pesos (code_jev) melhorou a calibração.

export type CalibrationGroup = {
  // Versão que produziu o NÚMERO: promptVersion no llm; as tags do motor
  // (lambda/judg/w) no code_jev — lá o promptVersion é o do narrador, que só narra.
  version: string;
  n: number; // predições (no N-ário cada uma rende N pares: model.n = N·n)
  model: CalibrationSummary;
  market: CalibrationSummary;
  // >0 ⇒ o modelo bate o mercado (log-loss/Brier do modelo MENORES que os do mercado).
  logLossSkill: number;
  brierSkill: number;
};

export function calibrationVersionOf(r: MarketCalibrationRow): string {
  return r.engine === "code_jev" && r.engineConfig
    ? r.engineConfig
    : r.promptVersion;
}

function summarize(
  rows: MarketCalibrationRow[],
  side: (r: MarketCalibrationRow) => CalibrationPair[],
): CalibrationSummary {
  const summary = computeCalibration(rows.flatMap(side));
  if (
    rows.length === 0 ||
    !rows.every((r) => MULTICLASS_LOG_LOSS.has(r.marketKey))
  ) {
    return summary;
  }
  // 1X2: −ln p do resultado real (a única seleção com y=1 da partição).
  const winners = rows.flatMap((r) => side(r).filter((pair) => pair.y === 1));
  return { ...summary, logLoss: logLoss(winners) };
}

function groupFor(
  version: string,
  rows: MarketCalibrationRow[],
): CalibrationGroup {
  const model = summarize(rows, (r) => r.model);
  const market = summarize(rows, (r) => r.market);
  return {
    version,
    n: rows.length,
    model,
    market,
    logLossSkill: market.logLoss - model.logLoss,
    brierSkill: market.brier - model.brier,
  };
}

export function deriveCalibration(rows: MarketCalibrationRow[]): {
  overall: CalibrationGroup | null;
  byVersion: CalibrationGroup[];
} {
  const buckets = new Map<string, MarketCalibrationRow[]>();
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
  rows: MarketCalibrationRow[],
  segment: EngineSegment,
): MarketCalibrationRow[] {
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
export function deriveCalibrationByEngine(rows: MarketCalibrationRow[]): {
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

// ── Segmentação por mercado (#453) ──────────────────────────────────────────

export function filterByMarket(
  rows: MarketCalibrationRow[],
  market: CalibratedMarketKey,
): MarketCalibrationRow[] {
  return rows.filter((r) => r.marketKey === market);
}

export type MarketCalibration = {
  market: CalibratedMarketKey;
  bets: number;
  group: CalibrationGroup | null; // null = sem amostra desse mercado ainda
};

/**
 * Uma linha por mercado, SEMPRE todos (ordem de CALIBRATED_MARKETS) — o mercado sem
 * amostra aparece com group=null, pra ficar explícito o que ainda não liquidou.
 */
export function deriveCalibrationByMarket(
  rows: MarketCalibrationRow[],
): MarketCalibration[] {
  return CALIBRATED_MARKETS.map((market) => {
    const rs = filterByMarket(rows, market);
    return {
      market,
      bets: rs.filter((r) => r.isBet).length,
      group: rs.length ? groupFor(market, rs) : null,
    };
  });
}
