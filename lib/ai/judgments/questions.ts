import type {
  JudgmentFactor,
  JudgmentQuestion,
  JudgmentQuestionId,
  JudgmentQuestionSet,
  TeamSide,
} from "./types";

// Conjunto FIXO e versionado de perguntas JEV (ADR 0041 §2). Mudou texto,
// criteria ou o vocabulário do state (state.ts)? Bump aqui + commit `prompt:`.
export const JUDGMENTS_VERSION = "jev_judgments_v1";

// Frases literais da tabela da Decisão 2 — sem negação (jaggedness #1).
const INSTRUCTIONS: Record<JudgmentFactor, string> = {
  attack_weakened:
    "The absences listed for this team remove a first-choice attacking player who is central to how the team scores.",
  defense_weakened:
    "The absences listed for this team remove a first-choice defender or the first-choice goalkeeper.",
  rotation_risk:
    "Given the fixture context, this team is likely to field a rotated or weakened lineup in this match.",
  high_stakes:
    "Given the league situation described, this match has high stakes for this team (title, qualification or relegation).",
};

// Casos de borda por escrito, apontando o campo do state pelo nome (jaggedness
// #1/#4). O vocabulário citado aqui é o que state.ts emite.
function criteriaFor(
  factor: JudgmentFactor,
  team: string
): JudgmentQuestion["criteria"] {
  switch (factor) {
    case "attack_weakened":
      return {
        true: `\`${team}.absences\` includes a starting forward or the team top scorer whose status is injured or suspended. A doubtful starting forward or doubtful top scorer is weaker evidence than an injured or suspended one.`,
        false: `\`${team}.absences\` is empty, or every listed player is a goalkeeper, a defender, a rotation player, a backup player, or a midfielder without the team top scorer tag.`,
      };
    case "defense_weakened":
      return {
        true: `\`${team}.absences\` includes a starting defender or the first-choice goalkeeper whose status is injured or suspended. A doubtful starting defender or doubtful first-choice goalkeeper is weaker evidence than an injured or suspended one.`,
        false: `\`${team}.absences\` is empty, or it lists only forwards, midfielders, rotation defenders or backup goalkeepers.`,
      };
    case "rotation_risk":
      return {
        true: `The schedule of \`${team}\` is congested: \`${team}.rest_before_match\` is short rest (<72h), or \`${team}.next_match\` is within 72h. A next match in a knockout or continental competition makes rotation more likely.`,
        false: `\`${team}.rest_before_match\` is normal rest, long rest or unknown, and \`${team}.next_match\` is 3 or more days away or unknown.`,
      };
    case "high_stakes":
      return {
        true: `\`${team}.league_situation\` is title race, continental qualification race, relegation zone or relegation battle. The stakes are highest when \`match.season_stage\` is final 5 rounds.`,
        false: `\`${team}.league_situation\` is safe mid-table, early season (table not settled) or unknown.`,
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
