import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

import { bootstrapMeanCi, logLoss } from "./metrics";

// Gate do Kelly fracionário (ADR 0039 D3; Report 03 rec. 7). Puro. Substitui o gate
// antigo (≥150 apostas + slope ∈ [0.8, 1.2]), que reprovava um modelo bem calibrado
// na maioria das vezes. Dois sinais:
//  - CLV: as recomendações batem a linha de fechamento? (Δ no-vig, pp) — o sinal de
//    edge de menor variância, sai no kickoff sem esperar resultado.
//  - Guarda: o modelo não pode perder do mercado no-vig com folga no log-loss
//    (todas as análises de over/under, passes incluídos).
// O Dixon-Coles (D2) é gated por backtest offline, não aqui.

export const KELLY_GATE = {
  minClvBets: 50,
  ciLevel: 0.9,
} as const;

export type KellyGateCheck = {
  key: "clv_sample" | "clv_mean" | "skill_guard";
  label: string;
  pass: boolean;
  detail: string;
};

export type KellyGate = {
  ready: boolean;
  clvBets: number;
  clvMeanPp: number; // NaN sem amostra
  clvCi: { lo: number; hi: number } | null;
  skillMean: number; // log-loss mercado − modelo, por análise; NaN sem amostra
  skillCi: { lo: number; hi: number } | null;
  checks: KellyGateCheck[];
};

const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export function evaluateKellyGate(input: {
  clvNoVigDeltasPp: number[];
  calibrationRows: OverUnderCalibrationRow[];
}): KellyGate {
  const { minClvBets, ciLevel } = KELLY_GATE;
  const clv = input.clvNoVigDeltasPp;
  const clvMeanPp = mean(clv);
  const clvCi = bootstrapMeanCi(clv, ciLevel);

  // Skill pareado por análise: log-loss do mercado − do modelo (> 0 = modelo melhor).
  const skills = input.calibrationRows.map(
    (r) =>
      logLoss([{ p: r.marketPOver, y: r.overHappened }]) -
      logLoss([{ p: r.modelPOver, y: r.overHappened }]),
  );
  const skillMean = mean(skills);
  const skillCi = bootstrapMeanCi(skills, ciLevel);
  const pct = Math.round(ciLevel * 100);

  const checks: KellyGateCheck[] = [
    {
      key: "clv_sample",
      label: `≥ ${minClvBets} apostas com closing line`,
      pass: clv.length >= minClvBets,
      detail: `${clv.length} / ${minClvBets}`,
    },
    {
      key: "clv_mean",
      label: `CLV no-vig médio > 0 (IC ${pct}% acima de 0)`,
      pass: clvCi !== null && clvCi.lo > 0,
      detail: clvCi
        ? `${f2(clvMeanPp)}pp [${f2(clvCi.lo)}, ${f2(clvCi.hi)}]`
        : "—",
    },
    {
      key: "skill_guard",
      label: `modelo não perde do mercado (IC ${pct}% do skill alcança 0)`,
      pass: skillCi !== null && skillCi.hi >= 0,
      detail: skillCi
        ? `${f3(skillMean)} [${f3(skillCi.lo)}, ${f3(skillCi.hi)}]`
        : "—",
    },
  ];

  return {
    ready: checks.every((c) => c.pass),
    clvBets: clv.length,
    clvMeanPp,
    clvCi,
    skillMean,
    skillCi,
    checks,
  };
}
