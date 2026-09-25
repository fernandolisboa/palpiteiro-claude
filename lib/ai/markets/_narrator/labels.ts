import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { JudgmentAbsenceInput } from "@/lib/ai/judgments/state";
import type {
  JudgmentAnswers,
  JudgmentFactor,
  JudgmentQuestionId,
  TeamSide,
} from "@/lib/ai/judgments/types";

import type { NarratorTeams } from "./types";

// Número em PT-BR (vírgula decimal).
export function fmtNumber(n: number, digits = 1): string {
  return n.toFixed(digits).replace(".", ",");
}

// Rótulos das seleções, o 1º é o de exibição e os demais são apelidos que a
// checagem de fidelidade procura no texto (lado contraditório).
export function selectionAliases(
  marketKey: string,
  key: string,
  teams: NarratorTeams,
  line: number | null
): string[] {
  const l = line === null ? null : fmtNumber(line);
  const lDot = line === null ? null : line.toFixed(1);
  switch (marketKey) {
    case "over_under":
      if (key === "over") {
        return [
          `Mais de ${l} gols (over ${l})`,
          `mais de ${l} gols`,
          `mais de ${lDot} gols`,
          `over ${l}`,
          `over ${lDot}`,
          "over",
        ];
      }
      if (key === "under") {
        return [
          `Menos de ${l} gols (under ${l})`,
          `menos de ${l} gols`,
          `menos de ${lDot} gols`,
          `under ${l}`,
          `under ${lDot}`,
          "under",
        ];
      }
      break;
    case "match_result":
      if (key === "home") return [`Vitória do ${teams.home}`, teams.home];
      if (key === "draw") return ["Empate", "empate"];
      if (key === "away") return [`Vitória do ${teams.away}`, teams.away];
      break;
    case "btts":
      // Nunca "sim"/"não" soltos: casariam com qualquer frase ("palpite não é
      // garantia") e gerariam falso positivo na fidelidade.
      if (key === "yes") {
        return [
          "Ambas marcam: sim",
          "ambos marcam: sim",
          "ambas marcam sim",
          "ambos marcam sim",
          "as duas equipes marcam",
        ];
      }
      if (key === "no") {
        return [
          "Ambas marcam: não",
          "ambos marcam: não",
          "ambas marcam não",
          "ambos marcam não",
          "as duas equipes não marcam",
        ];
      }
      break;
    case "double_chance":
      if (key === "home_or_draw") {
        return [`${teams.home} ou empate`, "casa ou empate"];
      }
      if (key === "away_or_draw") {
        return [
          `Empate ou ${teams.away}`,
          `${teams.away} ou empate`,
          "empate ou fora",
        ];
      }
      if (key === "home_or_away") {
        return [`${teams.home} ou ${teams.away}`, "casa ou fora"];
      }
      break;
  }
  return [key];
}

export function selectionLabel(
  marketKey: string,
  key: string,
  teams: NarratorTeams,
  line: number | null
): string {
  return selectionAliases(marketKey, key, teams, line)[0];
}

// ─── Fatores JEV → frases PT-BR (sem números) ─────────────────────────────────

const FACTOR_PHRASE: Record<
  JudgmentFactor,
  (team: string, opponent: string) => string
> = {
  attack_weakened: (team) =>
    `Desfalques tiram do ${team} uma peça ofensiva central (ataque do ${team} ajustado para baixo)`,
  defense_weakened: (team, opponent) =>
    `Desfalques atingem a defesa ou o goleiro titular do ${team} (gols esperados do ${opponent} ajustados para cima)`,
  rotation_risk: (team) =>
    `O ${team} tende a escalar um time poupado ou rotacionado (ataque ajustado para baixo)`,
  high_stakes: (team) =>
    `Jogo de peso na tabela para o ${team} (ataque ajustado levemente para cima)`,
};

const FACTORS: readonly JudgmentFactor[] = [
  "attack_weakened",
  "defense_weakened",
  "rotation_risk",
  "high_stakes",
];
const SIDES: readonly TeamSide[] = ["home", "away"];

// Só os fatores que de fato moveram λ (multiplicador ≠ 1, ou seja noul > 0.5).
export function judgmentFactorPhrases(
  answers: JudgmentAnswers | null,
  multipliers: JudgmentMultipliers | null,
  teams: NarratorTeams
): string[] {
  if (!answers || !multipliers) return [];
  const moved = new Map<JudgmentQuestionId, number>();
  for (const side of SIDES) {
    for (const [id, m] of Object.entries(multipliers[side].factors)) {
      if (m !== undefined && m !== 1) moved.set(id as JudgmentQuestionId, m);
    }
  }
  const phrases: string[] = [];
  for (const factor of FACTORS) {
    for (const side of SIDES) {
      const id: JudgmentQuestionId = `${factor}_${side}`;
      if (!moved.has(id)) continue;
      const team = side === "home" ? teams.home : teams.away;
      const opponent = side === "home" ? teams.away : teams.home;
      const strength =
        answers[id].value >= 0.8 ? "sinal forte" : "sinal moderado";
      phrases.push(`${FACTOR_PHRASE[factor](team, opponent)} — ${strength}`);
    }
  }
  return phrases;
}

// ─── Desfalque → função em PT-BR (nunca o nome) ───────────────────────────────

const POSITION_PT: Record<string, string> = {
  goalkeeper: "goleiro",
  defender: "defensor",
  midfielder: "meio-campista",
  forward: "atacante",
};

const STATUS_PT: Record<string, string> = {
  injured: "lesionado",
  suspended: "suspenso",
  doubtful: "dúvida",
};

export function describeAbsencePt(input: JudgmentAbsenceInput): string {
  const { position, isRegularStarter, isTopScorer } = input;
  let role = "jogador";
  if (position) {
    const base = POSITION_PT[position];
    if (isRegularStarter === undefined) role = base;
    else if (position === "goalkeeper") {
      role = isRegularStarter ? "goleiro titular" : "goleiro reserva";
    } else role = `${base} ${isRegularStarter ? "titular" : "reserva"}`;
  }
  if (isTopScorer) role = `${role}, artilheiro do time`;
  return `${role} (${STATUS_PT[input.injury.status] ?? input.injury.status})`;
}
