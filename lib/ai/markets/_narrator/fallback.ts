import { capKeyFactor, fmtNumber } from "./labels";
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
  // Contexto extra sem efeito no número (#569): o template também o registra, pra o
  // aviso do HERO valer em todo mercado do run, narrado pelo LLM ou não.
  const notes = d.userNotes ?? [];

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
  rationale = withLineupNotes(withNotes(rationale, notes), d.lineupNotes ?? []);
  // Escalação (#619) depois de probabilidade/edge (ou piso/candidata no pass): o número
  // continua sendo o 1º fato do card.
  // Cortadas no limite do fator (o schema rejeitaria a saída inteira).
  factors.push(...(d.lineupNotes ?? []).map(capKeyFactor));
  factors.push(...d.judgmentFactors);
  if (factors.length < 2) factors.push(goals);

  return {
    rationale: rationale.slice(0, RATIONALE_MAX_CHARS),
    key_factors: factors.slice(0, KEY_FACTORS_MAX),
  };
}

const NOTES_PREFIX = " Você também informou (não conferido, sem efeito nos números): ";

// As notas entram uma a uma enquanto cabem; nenhuma é cortada no meio.
function withNotes(rationale: string, notes: readonly string[]): string {
  const fit: string[] = [];
  for (const note of notes) {
    const next = `${rationale}${NOTES_PREFIX}${[...fit, note].join("; ")}.`;
    if (next.length > RATIONALE_MAX_CHARS) break;
    fit.push(note);
  }
  return fit.length > 0 ? `${rationale}${NOTES_PREFIX}${fit.join("; ")}.` : rationale;
}

// Reconferência com a escalação (#619): as notas ABREM o racional (é o que mudou desde a
// análise anterior). Entram enquanto cabem no limite junto do racional inteiro; nunca
// cortam os números do fim (as notas também vão nos fatores-chave).
function withLineupNotes(rationale: string, notes: readonly string[]): string {
  for (let n = notes.length; n > 0; n--) {
    const next = `${notes.slice(0, n).join(". ")}. ${rationale}`;
    if (next.length <= RATIONALE_MAX_CHARS) return next;
  }
  return rationale;
}
