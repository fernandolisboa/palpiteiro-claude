import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

import { computeCalibration } from "./metrics";

// Gate de dados da Fase C (Dixon-Coles MLE + Kelly fracionário — Report 03 rec. 6/7,
// critério de saída do deferimento do ADR 0019). Puro. Avaliado SÓ sobre apostas
// (isBet): é nelas que o Kelly vai dimensionar stake, e é o subconjunto em que o
// modelo discorda do mercado — onde overconfidence aparece primeiro. Passes ficam
// fora do gate (entram no harness geral).

export const PHASE_C_GATE = {
  minSettledBets: 150,
  slopeMin: 0.8,
  slopeMax: 1.2,
} as const;

export type PhaseCGateCheck = {
  key: "sample" | "slope" | "brier";
  label: string;
  pass: boolean;
  detail: string;
};

export type PhaseCGate = {
  ready: boolean;
  settledBets: number;
  slope: number; // NaN quando não identificável
  modelBrier: number;
  marketBrier: number;
  checks: PhaseCGateCheck[];
};

const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");

export function evaluatePhaseCGate(
  rows: OverUnderCalibrationRow[],
): PhaseCGate {
  const bets = rows.filter((r) => r.isBet);
  const model = computeCalibration(
    bets.map((r) => ({ p: r.modelPOver, y: r.overHappened })),
  );
  const market = computeCalibration(
    bets.map((r) => ({ p: r.marketPOver, y: r.overHappened })),
  );
  const { minSettledBets, slopeMin, slopeMax } = PHASE_C_GATE;

  const checks: PhaseCGateCheck[] = [
    {
      key: "sample",
      label: `≥ ${minSettledBets} apostas liquidadas`,
      pass: bets.length >= minSettledBets,
      detail: `${bets.length} / ${minSettledBets}`,
    },
    {
      key: "slope",
      label: `slope de calibração ∈ [${slopeMin}, ${slopeMax}]`,
      // NaN falha as duas comparações → não passa (sem dado, sem gate).
      pass: model.slope >= slopeMin && model.slope <= slopeMax,
      detail: f3(model.slope),
    },
    {
      key: "brier",
      label: "Brier do modelo ≤ mercado no-vig",
      pass: model.brier <= market.brier,
      detail: `${f3(model.brier)} vs ${f3(market.brier)}`,
    },
  ];

  return {
    ready: checks.every((c) => c.pass),
    settledBets: bets.length,
    slope: model.slope,
    modelBrier: model.brier,
    marketBrier: market.brier,
    checks,
  };
}
