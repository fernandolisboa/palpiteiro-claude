import {
  LINEUP_CHANGES_LABEL,
  LINEUP_CHANGES_UNKNOWN,
  LINEUP_NOT_ANNOUNCED,
} from "./lineup-vocabulary";
import type {
  JudgmentFactor,
  JudgmentQuestion,
  JudgmentQuestionId,
  JudgmentQuestionSet,
  TeamSide,
} from "./types";

// Conjunto FIXO e versionado de perguntas JEV (ADR 0041 §2). Mudou texto,
// criteria ou o vocabulário do state (state.ts)? Bump aqui + commit `prompt:`.
// v2 (#617): `next_match` preenchido (competição + "knockout"/"group stage" entre
// parênteses), descanso conta jogo ainda não disputado antes deste, tag "team top
// scorer" sai de fato e `league_situation` existe na Premier League e na La Liga.
// v3 (#619): escalação confirmada — `lineup` (mudanças VOLUNTÁRIAS sobre o XI de
// referência) e `starters_left_out` em rotation_risk, attack_weakened e
// defense_weakened; com a escalação anunciada, quem segue em `absences` está fora do
// XI (em dúvida inclusive).
export const JUDGMENTS_VERSION = "jev_judgments_v3";

// Frases literais da tabela da Decisão 2 — sem negação (jaggedness #1).
const INSTRUCTIONS: Record<JudgmentFactor, string> = {
  attack_weakened:
    "The absences or lineup choices listed for this team remove a first-choice attacking player who is central to how the team scores.",
  defense_weakened:
    "The absences or lineup choices listed for this team remove a first-choice defender or the first-choice goalkeeper.",
  rotation_risk:
    "Given the fixture context, this team is likely to field a rotated or weakened lineup in this match.",
  high_stakes:
    "Given the league situation described, this match has high stakes for this team (title, qualification or relegation).",
};

// Casos de borda por escrito, apontando o campo do state pelo nome (jaggedness
// #1/#4). O vocabulário citado aqui é o que state.ts emite.
// Com a escalação anunciada, o código já tirou de `absences` quem vai começar
// jogando (state.ts, enrichAbsences): o que sobra está fora do XI.
function announcedAbsencesNote(team: string): string {
  return `Once \`${team}.lineup\` is announced, every player still listed in \`${team}.absences\` is outside the starting lineup, including doubtful ones.`;
}

function criteriaFor(
  factor: JudgmentFactor,
  team: string
): JudgmentQuestion["criteria"] {
  const lineupUnknown = `\`${team}.lineup\` is "${LINEUP_NOT_ANNOUNCED}" or "${LINEUP_CHANGES_UNKNOWN}"`;
  switch (factor) {
    case "attack_weakened":
      return {
        true: `\`${team}.absences\` includes a starting forward or the team top scorer whose status is injured or suspended, or \`${team}.starters_left_out\` includes a starting forward. A doubtful starting forward or doubtful top scorer is weaker evidence than an injured or suspended one while \`${team}.lineup\` is "${LINEUP_NOT_ANNOUNCED}". ${announcedAbsencesNote(team)}`,
        false: `\`${team}.absences\` is empty, or every listed player is a goalkeeper, a defender, a rotation player, a backup player, a midfielder without the team top scorer tag, or a player of unknown role without the team top scorer tag; and \`${team}.starters_left_out\` has no starting forward. An absence listed only as \`player (...)\` has an unknown role and does not by itself make the statement true.`,
      };
    case "defense_weakened":
      return {
        true: `\`${team}.absences\` includes a starting defender or the first-choice goalkeeper whose status is injured or suspended, or \`${team}.starters_left_out\` includes a starting defender or the first-choice goalkeeper. A doubtful starting defender or doubtful first-choice goalkeeper is weaker evidence than an injured or suspended one while \`${team}.lineup\` is "${LINEUP_NOT_ANNOUNCED}". ${announcedAbsencesNote(team)}`,
        false: `\`${team}.absences\` is empty, or it lists only forwards, midfielders, rotation defenders, backup goalkeepers or players of unknown role; and \`${team}.starters_left_out\` has no starting defender and no first-choice goalkeeper. An absence listed only as \`player (...)\` has an unknown role and does not by itself make the statement true.`,
      };
    case "rotation_risk":
      return {
        true: `When \`${team}.lineup\` gives a number of voluntary changes, the announced lineup decides: "${LINEUP_CHANGES_LABEL["5+"]}" is strong evidence of rotation and "${LINEUP_CHANGES_LABEL["3-4"]}" is moderate evidence; a first-choice goalkeeper in \`${team}.starters_left_out\` also points to rotation. When ${lineupUnknown}, the schedule decides: the schedule of \`${team}\` is congested when \`${team}.rest_before_match\` is short rest (<72h), or \`${team}.next_match\` is within 72h. \`${team}.next_match\` names the competition in parentheses; a next match marked knockout, or in a continental competition (for example CONMEBOL Libertadores, CONMEBOL Sudamericana, UEFA Champions League, UEFA Europa League), makes rotation more likely.`,
        false: `\`${team}.lineup\` is "${LINEUP_CHANGES_LABEL["0-2"]}" and \`${team}.starters_left_out\` has no first-choice goalkeeper, whatever the schedule. Or ${lineupUnknown}, \`${team}.rest_before_match\` is normal rest, long rest or unknown, and \`${team}.next_match\` is 3 or more days away or unknown.`,
      };
    case "high_stakes":
      return {
        true: `\`${team}.league_situation\` is title race, continental qualification race, relegation zone or relegation battle. The stakes are highest when \`match.season_stage\` is final 5 rounds.`,
        false: `\`${team}.league_situation\` is safe mid-table, secure in continental places, early season (table not settled) or unknown.`,
      };
  }
}

const STATE_KEY: Record<TeamSide, string> = {
  home: "home_team",
  away: "away_team",
};

function buildQuestion(
  factor: JudgmentFactor,
  side: TeamSide
): JudgmentQuestion {
  const team = STATE_KEY[side];
  return {
    type: "noul",
    // Objeto com a pergunta literal num campo e o alvo em outro (padrão
    // "structured instructions" da doc TypeSafe).
    instructions: { this_team: team, question: INSTRUCTIONS[factor] },
    criteria: criteriaFor(factor, team),
  };
}

export const JUDGMENT_QUESTION_IDS: readonly JudgmentQuestionId[] = [
  "attack_weakened_home",
  "attack_weakened_away",
  "defense_weakened_home",
  "defense_weakened_away",
  "rotation_risk_home",
  "rotation_risk_away",
  "high_stakes_home",
  "high_stakes_away",
];

export const JUDGMENT_QUESTIONS: JudgmentQuestionSet = {
  attack_weakened_home: buildQuestion("attack_weakened", "home"),
  attack_weakened_away: buildQuestion("attack_weakened", "away"),
  defense_weakened_home: buildQuestion("defense_weakened", "home"),
  defense_weakened_away: buildQuestion("defense_weakened", "away"),
  rotation_risk_home: buildQuestion("rotation_risk", "home"),
  rotation_risk_away: buildQuestion("rotation_risk", "away"),
  high_stakes_home: buildQuestion("high_stakes", "home"),
  high_stakes_away: buildQuestion("high_stakes", "away"),
};
