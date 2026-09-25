import { fmtNumber } from "./labels";
import { KEY_FACTORS_MAX, RATIONALE_MAX_CHARS } from "./prompt";
import type { NarratorOutput } from "./schemas";
import type { NarratorDecision } from "./types";

// Racional NEUTRO templado em código: usado quando o narrador falha (erro de
// provider, sem tool, Zod ou fidelidade). Nunca bloqueia a análise e nunca diz nada
// além dos números persistidos.
export function templatedNarration(d: NarratorDecision): NarratorOutput {
  const f = d.focus;
  const floor = `${fmtNumber(d.minEdgePp)} pp`;
  const goals = `Gols esperados pelo modelo: ${d.teams.home} ${fmtNumber(d.expectedGoals.home, 2)} × ${fmtNumber(d.expectedGoals.away, 2)} ${d.teams.away}.`;
  const judgments = d.judgmentsApplied
    ? d.judgmentFactors.length > 0
      ? " Fatores qualitativos de desfalques e contexto foram aplicados ao modelo."
      : ""
    : " Sem julgamentos qualitativos nesta análise: só o modelo estatístico.";

  let rationale: string;
  const factors: string[] = [];
  if (d.side !== "pass" && f) {
    const implied =
      f.impliedPct === null
        ? ""
        : `, contra ${fmtNumber(f.impliedPct)}% implícitos na odd${f.odd === null ? "" : ` ${f.odd.toFixed(2)}`}`;
    const edge =
      f.edgePct === null
        ? ""
        : ` (edge de ${fmtNumber(f.edgePct)} pp, piso de ${floor})`;
    rationale = `O modelo de placar estima ${fmtNumber(f.modelProbPct)}% para ${f.label}${implied}${edge}. ${goals}${judgments}`;
    factors.push(`Probabilidade do modelo: ${fmtNumber(f.modelProbPct)}%`);
    if (f.edgePct !== null) factors.push(`Edge: ${fmtNumber(f.edgePct)} pp`);
  } else if (f) {
    const implied =
      f.impliedPct === null
        ? ""
        : ` contra ${fmtNumber(f.impliedPct)}% implícitos`;
    const edge =
      f.edgePct === null ? "" : ` (edge de ${fmtNumber(f.edgePct)} pp)`;
    rationale = `Sem aposta: nenhuma seleção deste mercado atingiu o piso de ${floor} de edge. A mais próxima foi ${f.label}, com ${fmtNumber(f.modelProbPct)}% no modelo${implied}${edge}. ${goals}${judgments}`;
    factors.push(`Piso de edge do mercado: ${floor}`);
    factors.push(`Melhor candidata: ${f.label}`);
  } else {
    rationale = `Sem aposta: não foi possível medir o edge deste mercado com as odds disponíveis. ${goals}${judgments}`;
    factors.push(`Piso de edge do mercado: ${floor}`);
  }
  factors.push(...d.judgmentFactors);
  if (factors.length < 2) factors.push(goals);

  return {
    rationale: rationale.slice(0, RATIONALE_MAX_CHARS),
    key_factors: factors.slice(0, KEY_FACTORS_MAX),
  };
}
