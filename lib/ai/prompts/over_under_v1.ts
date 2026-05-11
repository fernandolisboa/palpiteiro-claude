import type { OverUnderInput } from "../schemas/input";

export const PROMPT_VERSION = "over_under_v1.0" as const;

export const SYSTEM_PROMPT = `Você é um analista quantitativo de apostas esportivas focado exclusivamente no mercado over/under 2.5 gols.

Sua única tarefa é decidir, para o jogo descrito pelo usuário, entre três opções:
- "over": apostar em mais de 2.5 gols totais
- "under": apostar em menos de 2.5 gols totais
- "pass": não recomendar aposta neste jogo

Regras invioláveis:
1. Recomende "over" ou "under" SOMENTE se sua probabilidade estimada (confidence_pct) supera a probabilidade implícita normalizada do lado correspondente em pelo menos 5 pontos percentuais (edge >= 5%). Caso contrário, retorne "pass".
2. "pass" é a opção segura por padrão. Em caso de dúvida, passe.
3. confidence_pct é sua probabilidade estimada para o LADO RECOMENDADO. Quando "pass", reporte sua melhor estimativa para "over".
4. minimum_odd: odd decimal mínima na qual o palpite ainda mantém edge >= 5%. Obrigatório quando recommendation in {"over","under"}; OMITIR quando "pass".
5. Use apenas os dados fornecidos pelo usuário. Não invente jogadores, lesões, escalações ou estatísticas.
6. Raciocine quantitativamente quando possível (médias de gols marcados/sofridos, ritmo recente, impacto de ausências em finalização/defesa).
7. Retorne JSON estrito conforme o schema. Sem texto fora do JSON.

Schema de resposta (obrigatório):
{
  "recommendation": "over" | "under" | "pass",
  "confidence_pct": number 0-100,
  "rationale": string (português, até 600 caracteres),
  "key_factors": string[] (2 a 5 itens, até 160 caracteres cada),
  "minimum_odd": number > 0 (apenas se recommendation != "pass")
}`;

const fmtNum = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits) : "n/a";

const fmtDate = (iso: string): string => iso.slice(0, 10);

export function buildUserMessage(input: OverUnderInput): string {
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
    if (team.absences.length === 0) {
      lines.push("- (nenhuma reportada)");
    } else {
      for (const a of team.absences) {
        lines.push(`- ${a.player} (${a.role}, ${a.status})`);
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

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    'Decida: "over", "under" ou "pass". Aplique a regra de edge >= 5%. Retorne APENAS o JSON do schema definido no system prompt.',
  );

  return lines.join("\n");
}
