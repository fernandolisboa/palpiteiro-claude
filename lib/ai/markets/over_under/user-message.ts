import type { OverUnderInput } from "./schemas";

export const fmtNum = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits) : "n/a";

const fmtDate = (iso: string): string => iso.slice(0, 10);

export type UserMessageContext = {
  daysToKickoff: number;
};

// Subconjunto de campos comuns a OverUnderInput (v2) e OverUnderInputV3 (v3): só o
// CONTEXTO (match/home/away/h2h), sem o bloco de odds (que diverge entre v2 e v3).
// O v3 reaproveita renderContextSections SEM duplicar — o snapshot golden do v2
// prova que a saída ficou byte-idêntica (as primeiras seções não mudam).
type ContextInput = Pick<OverUnderInput, "match" | "home" | "away" | "h2h">;

// Renderiza as seções de contexto (# Jogo, # Mandante/Visitante, # Confrontos
// diretos H2H) — tudo ATÉ o bloco de odds. Devolve as linhas (sem trailing blank)
// pra cada cartucho anexar seu próprio bloco de odds + contexto temporal + tarefa.
export function renderContextSections(input: ContextInput): string[] {
  const lines: string[] = [];

  lines.push("# Jogo");
  lines.push(`- Competição: ${input.match.league}`);
  lines.push(`- Mandante: ${input.match.home_team.name}`);
  lines.push(`- Visitante: ${input.match.away_team.name}`);
  lines.push(`- Kickoff (UTC): ${input.match.kickoff_at}`);
  if (input.match.venue) {
    lines.push(`- Local: ${input.match.venue}`);
  }

  for (const side of ["home", "away"] as const) {
    const team = input[side];
    const ref =
      side === "home" ? input.match.home_team : input.match.away_team;
    const label = side === "home" ? "Mandante" : "Visitante";

    lines.push("");
    lines.push(`# ${label} — ${ref.name}`);

    lines.push("## Classificação");
    const st = team.standing;
    lines.push(
      `- Posição: ${st.position}, ${st.points} pts em ${st.played} jogos`,
    );
    lines.push(
      `- Gols: ${st.goals_for} pró / ${st.goals_against} contra (saldo ${st.goals_for - st.goals_against})`,
    );
    if (st.home_split) {
      const s = st.home_split;
      lines.push(
        `- Em casa: ${s.played}J ${s.wins}V ${s.draws}E ${s.losses}D, ${s.goals_for}-${s.goals_against}`,
      );
    }
    if (st.away_split) {
      const s = st.away_split;
      lines.push(
        `- Fora: ${s.played}J ${s.wins}V ${s.draws}E ${s.losses}D, ${s.goals_for}-${s.goals_against}`,
      );
    }

    lines.push("## Forma recente (mais recente primeiro)");
    if (team.form.matches.length === 0) {
      lines.push("- (sem dados)");
    } else {
      for (const m of team.form.matches) {
        const side_marker = m.home_or_away === "home" ? "vs" : "@";
        lines.push(
          `- ${fmtDate(m.date)} ${side_marker} ${m.opponent}: ${m.goals_for}-${m.goals_against} (${m.result})`,
        );
      }
    }

    lines.push("## Lesões / Suspensões");
    if (!team.absences_available) {
      lines.push("- Lesões: dados indisponíveis nesta análise");
    } else if (team.absences.length === 0) {
      lines.push("- (nenhuma reportada)");
    } else {
      for (const a of team.absences) {
        // Proveniência (ADR 0026, #226): expõe `fonte` quando presente pro prompt
        // ponderar confiança (oficial > não-oficial). Compartilhado v2+v3.
        const fonte = a.source ? `, fonte: ${a.source}` : "";
        lines.push(`- ${a.player} (${a.role}, ${a.status}${fonte})`);
      }
    }

    if (team.lineup) {
      const formation = team.lineup.formation
        ? ` (${team.lineup.formation})`
        : "";
      lines.push(`## Escalação provável${formation}`);
      for (const p of team.lineup.starters) {
        lines.push(`- ${p.player} (${p.role})`);
      }
    }
  }

  lines.push("");
  lines.push("# Confrontos diretos (H2H)");
  if (input.h2h.length === 0) {
    lines.push("- (sem histórico fornecido)");
  } else {
    for (const m of input.h2h) {
      const total = m.score_home + m.score_away;
      lines.push(
        `- ${fmtDate(m.date)}: ${m.home_team} ${m.score_home}-${m.score_away} ${m.away_team} (total ${total})`,
      );
    }
  }

  return lines;
}

// Bloco "# Contexto temporal" — compartilhado v2/v3 (idêntico). Empurra nas linhas
// recebidas (com a linha em branco separadora antes do header).
export function pushTemporalSection(
  lines: string[],
  context: UserMessageContext,
): void {
  lines.push("");
  lines.push("# Contexto temporal");
  lines.push(
    `- Dias até o jogo: ${context.daysToKickoff} (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)`,
  );
}

export function buildUserMessage(
  input: OverUnderInput,
  context: UserMessageContext,
): string {
  const lines = renderContextSections(input);

  lines.push("");
  lines.push("# Odds e probabilidades implícitas");
  lines.push(
    `- Bookmaker: ${input.odds.bookmaker} (capturado em ${input.odds.captured_at})`,
  );
  lines.push(
    `- Over 2.5: odd ${fmtNum(input.odds.over_2_5_decimal)} → implícita normalizada ${fmtNum(input.implied.over_pct)}%`,
  );
  lines.push(
    `- Under 2.5: odd ${fmtNum(input.odds.under_2_5_decimal)} → implícita normalizada ${fmtNum(input.implied.under_pct)}%`,
  );

  pushTemporalSection(lines, context);

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    'Decida: "over", "under" ou "pass". Aplique a regra de edge >= 5%. Chame a ferramenta submit_prediction com os campos do schema.',
  );

  return lines.join("\n");
}
