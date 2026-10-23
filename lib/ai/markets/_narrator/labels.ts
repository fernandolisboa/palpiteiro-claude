import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { LineupChangeBucket } from "@/lib/ai/judgments/lineup-vocabulary";
import type {
  JudgmentAbsenceInput,
  LineupLeftOut,
  LineupSummary,
} from "@/lib/ai/judgments/state";
import type {
  JudgmentAnswers,
  JudgmentFactor,
  JudgmentQuestionId,
  TeamSide,
} from "@/lib/ai/judgments/types";

import type { NarratorTeams, UserFactorOrigins } from "./types";

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
  // narrator_v1.4 (#619): na v3 do JEV o fator também sobe por titular poupado.
  attack_weakened: (team) =>
    `Desfalques ou titulares poupados tiram do ${team} uma peça ofensiva central (ataque do ${team} ajustado para baixo)`,
  defense_weakened: (team, opponent) =>
    `Desfalques ou titulares poupados atingem a defesa ou o goleiro titular do ${team} (gols esperados do ${opponent} ajustados para cima)`,
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

const STRONG_SIGNAL = 0.8;

const USER_ORIGIN_LABEL: Record<"confirmed" | "unverified", string> = {
  confirmed: "(informado por você)",
  unverified: "(informado por você, não conferido)",
};

// Só os fatores que de fato moveram λ (multiplicador ≠ 1, ou seja noul > 0.5). Com o
// contexto extra (#565), `user.origins` diz quais fatores o usuário moveu: a frase
// ganha a origem e a força ("sinal forte/moderado") vem SÓ do valor do JEV, nunca do
// noul do usuário (sem JEV acima do neutro, a frase sai sem força).
export function judgmentFactorPhrases(
  answers: JudgmentAnswers | null,
  multipliers: JudgmentMultipliers | null,
  teams: NarratorTeams,
  user?: { jev: JudgmentAnswers | null; origins: UserFactorOrigins }
): string[] {
  if (!answers || !multipliers) return [];
  const moved = new Map<JudgmentQuestionId, number>();
  for (const side of SIDES) {
    for (const [id, m] of Object.entries(multipliers[side].factors)) {
      if (m !== undefined && m !== 1) moved.set(id as JudgmentQuestionId, m);
    }
  }
  const strengthOf = (value: number) =>
    value >= STRONG_SIGNAL ? "sinal forte" : "sinal moderado";
  const phrases: string[] = [];
  for (const factor of FACTORS) {
    for (const side of SIDES) {
      const id: JudgmentQuestionId = `${factor}_${side}`;
      if (!moved.has(id)) continue;
      const team = side === "home" ? teams.home : teams.away;
      const opponent = side === "home" ? teams.away : teams.home;
      const phrase = FACTOR_PHRASE[factor](team, opponent);
      const origin = user?.origins[id];
      if (!origin) {
        phrases.push(`${phrase} — ${strengthOf(answers[id].value)}`);
        continue;
      }
      const jevValue = user?.jev?.[id]?.value ?? 0;
      const strength = jevValue > 0.5 ? ` — ${strengthOf(jevValue)}` : "";
      phrases.push(`${phrase}${strength} ${USER_ORIGIN_LABEL[origin]}`);
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

// ─── Escalação confirmada → frases PT-BR (#619, reconferência; nunca o nome) ──

const LEFT_OUT_PLACE_PT: Record<
  NonNullable<LineupLeftOut["whereabouts"]>,
  string
> = {
  bench: "no banco",
  out_of_squad: "fora da lista",
};

const CHANGES_PT: Record<LineupChangeBucket, string> = {
  "0-2": "0 a 2 mudanças por escolha",
  "3-4": "3 a 4 mudanças por escolha",
  "5+": "5 ou mais mudanças por escolha",
};

// Quantos papéis citar entre parênteses; o resto vira "e mais N".
const LEFT_OUT_ROLES_MAX = 3;

function leftOutRolePt(entry: LineupLeftOut): string {
  const base = entry.position
    ? entry.position === "goalkeeper"
      ? "goleiro titular"
      : `${POSITION_PT[entry.position]} titular`
    : "titular";
  return entry.whereabouts
    ? `${base} ${LEFT_OUT_PLACE_PT[entry.whereabouts]}`
    : base;
}

function lineupNoteForTeam(
  summary: LineupSummary,
  team: string,
  startingAbsentees: number,
): string | null {
  if (summary.status !== "announced") return null;
  let phrase: string;
  if (summary.changes === null) {
    phrase = `Escalação do ${team} confirmada, sem como comparar com o time titular habitual`;
  } else {
    phrase = `Escalação do ${team} confirmada com ${CHANGES_PT[summary.changes]} em relação ao time titular habitual`;
    if (summary.leftOut.length > 0) {
      const roles = summary.leftOut.slice(0, LEFT_OUT_ROLES_MAX).map(leftOutRolePt);
      const more = summary.leftOut.length - roles.length;
      phrase += ` (${roles.join(", ")}${more > 0 ? ` e mais ${more}` : ""})`;
    }
  }
  if (startingAbsentees > 0) {
    phrase +=
      startingAbsentees === 1
        ? "; 1 jogador listado como desfalque está entre os titulares"
        : `; ${startingAbsentees} jogadores listados como desfalque estão entre os titulares`;
  }
  return phrase;
}

/**
 * Notas da escalação confirmada pra reconferência (#619): uma frase por time com a
 * escalação anunciada (mudanças por escolha, papéis dos titulares habituais fora e
 * desfalcados da lista do provider que vão começar jogando). Sem nome de jogador: a
 * entrada já é o LineupSummary (papéis), que é o que sai de state.ts.
 */
export function lineupNotePhrases(
  lineup: { home: LineupSummary; away: LineupSummary },
  teams: NarratorTeams,
  startingAbsentees: { home: number; away: number } = { home: 0, away: 0 },
): string[] {
  return [
    lineupNoteForTeam(lineup.home, teams.home, startingAbsentees.home),
    lineupNoteForTeam(lineup.away, teams.away, startingAbsentees.away),
  ].filter((p): p is string => p !== null);
}
