import { fmtNumber } from "./labels";
import type { NarratorContext, NarratorDecision } from "./types";

function pct(n: number): string {
  return `${fmtNumber(n)}%`;
}

function pp(n: number): string {
  return `${fmtNumber(n)} pp`;
}

function decisionBlock(d: NarratorDecision): string[] {
  const lines: string[] = [];
  lines.push(
    `- Mercado: ${d.marketLabel}${d.line === null ? "" : ` (linha ${fmtNumber(d.line)})`}`
  );
  const f = d.focus;
  if (d.side === "pass") {
    lines.push(
      `- Decisão: SEM APOSTA (nenhuma seleção atingiu o piso de edge de ${pp(d.minEdgePp)})`
    );
    if (f) {
      lines.push(`- Seleção mais próxima de ter valor: ${f.label}`);
    } else {
      lines.push("- Edge não mensurável com as odds disponíveis");
    }
  } else {
    lines.push(`- Decisão: APOSTAR em ${f ? f.label : d.side}`);
  }
  if (f) {
    lines.push(`- Probabilidade do modelo: ${pct(f.modelProbPct)}`);
    if (f.impliedPct !== null) {
      lines.push(
        `- Probabilidade implícita na odd (sem margem): ${pct(f.impliedPct)}`
      );
    }
    if (f.edgePct !== null) {
      lines.push(
        `- Edge: ${pp(f.edgePct)} (piso do mercado: ${pp(d.minEdgePp)})`
      );
    }
    if (f.odd !== null) lines.push(`- Odd: ${f.odd.toFixed(2)}`);
  }
  if (d.stakeUnits !== null) {
    lines.push(`- Stake: ${fmtNumber(d.stakeUnits, 2)}u`);
  }
  lines.push(
    `- Gols esperados pelo modelo: ${d.teams.home} ${fmtNumber(d.expectedGoals.home, 2)} × ${fmtNumber(d.expectedGoals.away, 2)} ${d.teams.away}`
  );
  return lines;
}

function judgmentBlock(d: NarratorDecision): string[] {
  if (!d.judgmentsApplied) {
    return [
      "- Julgamentos qualitativos indisponíveis nesta análise: a decisão usa só o modelo estatístico.",
    ];
  }
  if (d.judgmentFactors.length === 0) {
    return [
      "- Nenhum fator qualitativo relevante (desfalques, rotação ou peso do jogo) alterou o modelo.",
    ];
  }
  return d.judgmentFactors.map((f) => `- ${f}`);
}

function contextBlock(c: NarratorContext, d: NarratorDecision): string[] {
  const lines: string[] = [];
  lines.push(
    `- Jogo: ${d.teams.home} (casa) x ${d.teams.away} (fora) — ${c.leagueLabel}, ${c.kickoffAt}${c.venue ? `, ${c.venue}` : ""}`
  );
  if (c.standings.length > 0) {
    lines.push("- Tabela:");
    for (const s of c.standings) {
      lines.push(
        `  - ${s.team}: ${s.position}º, ${s.points} pts em ${s.played} jogos, ${s.goalsFor} gols marcados e ${s.goalsAgainst} sofridos`
      );
    }
  } else {
    lines.push("- Tabela: indisponível");
  }
  const form = (team: string, entries: string[]) =>
    `  - ${team}: ${entries.length > 0 ? entries.join("; ") : "sem dados"}`;
  lines.push("- Forma recente (mais recente primeiro):");
  lines.push(form(d.teams.home, c.form.home));
  lines.push(form(d.teams.away, c.form.away));
  lines.push(
    `- Confrontos diretos: ${c.h2h.length > 0 ? c.h2h.join("; ") : "sem dados"}`
  );
  if (!c.absences.available) {
    lines.push("- Desfalques: dados indisponíveis");
  } else {
    const abs = (team: string, entries: string[]) =>
      `  - ${team}: ${entries.length > 0 ? entries.join("; ") : "nenhum informado"}`;
    lines.push("- Desfalques (por função):");
    lines.push(abs(d.teams.home, c.absences.home));
    lines.push(abs(d.teams.away, c.absences.away));
  }
  return lines;
}

export function buildNarratorMessage(
  decision: NarratorDecision,
  context: NarratorContext
): string {
  return [
    "## Decisão (fixa — não altere)",
    ...decisionBlock(decision),
    "",
    "## Fatores qualitativos já aplicados ao modelo",
    ...judgmentBlock(decision),
    "",
    "## Contexto",
    ...contextBlock(context, decision),
    "",
    "Escreva o racional e os fatores-chave desta decisão via submit_narration.",
  ].join("\n");
}
