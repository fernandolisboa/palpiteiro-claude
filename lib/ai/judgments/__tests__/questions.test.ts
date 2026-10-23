import { describe, expect, it } from "vitest";

import {
  JUDGMENT_QUESTION_IDS,
  JUDGMENT_QUESTIONS,
  JUDGMENTS_VERSION,
} from "../questions";
import {
  LINEUP_CHANGES_LABEL,
  LINEUP_CHANGES_UNKNOWN,
  LINEUP_NOT_ANNOUNCED,
  lineupStateFields,
} from "../state";

type Criteria = { true: string; false: string };
const criteria = (id: keyof typeof JUDGMENT_QUESTIONS) =>
  JUDGMENT_QUESTIONS[id].criteria as Criteria;

describe("jev_judgments_v3", () => {
  it("versão e as 8 perguntas noul", () => {
    expect(JUDGMENTS_VERSION).toBe("jev_judgments_v3");
    expect(JUDGMENT_QUESTION_IDS).toHaveLength(8);
    expect(Object.keys(JUDGMENT_QUESTIONS).sort()).toEqual(
      [...JUDGMENT_QUESTION_IDS].sort()
    );
    for (const q of Object.values(JUDGMENT_QUESTIONS)) {
      expect(q.type).toBe("noul");
      expect(q.criteria.true).toBeTruthy();
      expect(q.criteria.false).toBeTruthy();
    }
  });

  it("instruções literais da tabela da Decisão 2, apontando o time certo", () => {
    expect(JUDGMENT_QUESTIONS.defense_weakened_away.instructions).toEqual({
      this_team: "away_team",
      question:
        "The absences or lineup choices listed for this team remove a first-choice defender or the first-choice goalkeeper.",
    });
    expect(JUDGMENT_QUESTIONS.attack_weakened_home.criteria.true).toContain(
      "`home_team.absences`"
    );
  });

  it("perguntas sem negação", () => {
    for (const q of Object.values(JUDGMENT_QUESTIONS)) {
      const { question } = q.instructions as { question: string };
      expect(question).not.toMatch(/\b(not|no|never|without)\b|n't/i);
    }
  });

  it("desfalque de papel desconhecido não basta pra ataque/defesa enfraquecidos", () => {
    for (const id of [
      "attack_weakened_home",
      "defense_weakened_away",
    ] as const) {
      expect(JUDGMENT_QUESTIONS[id].criteria.false).toContain(
        "`player (...)` has an unknown role and does not by itself make the statement true"
      );
    }
  });

  it("high_stakes cita todo bucket de tabela que state.ts emite", () => {
    const { true: yes, false: no } = JUDGMENT_QUESTIONS.high_stakes_home
      .criteria as { true: string; false: string };
    for (const bucket of [
      "title race",
      "continental qualification race",
      "relegation zone",
      "relegation battle",
    ]) {
      expect(yes).toContain(bucket);
    }
    for (const bucket of [
      "safe mid-table",
      "secure in continental places",
      "early season (table not settled)",
      "unknown",
    ]) {
      expect(no).toContain(bucket);
    }
  });

  it("rotation_risk cita todo valor de `lineup` que state.ts emite (#619)", () => {
    const { true: yes, false: no } = criteria("rotation_risk_away");
    const all = `${yes} ${no}`;
    for (const text of [
      LINEUP_NOT_ANNOUNCED,
      LINEUP_CHANGES_UNKNOWN,
      ...Object.values(LINEUP_CHANGES_LABEL),
    ]) {
      expect(all).toContain(`"${text}"`);
    }
    // Mudanças: 5+ e 3–4 apontam rotação; 0–2 nega, qualquer calendário.
    expect(yes).toContain(LINEUP_CHANGES_LABEL["5+"]);
    expect(yes).toContain(LINEUP_CHANGES_LABEL["3-4"]);
    expect(no).toContain(`${LINEUP_CHANGES_LABEL["0-2"]}"`);
    expect(no).toContain("whatever the schedule");
    expect(yes).toContain("`away_team.starters_left_out`");
    expect(yes).toContain("first-choice goalkeeper");
    // O critério de calendário segue valendo sem escalação.
    expect(yes).toContain("`away_team.rest_before_match` is short rest (<72h)");
    // O vocabulário citado é o que lineupStateFields de fato emite.
    expect(lineupStateFields({ status: "not_announced" }).lineup).toBe(
      LINEUP_NOT_ANNOUNCED
    );
  });

  it("attack/defense_weakened leem `starters_left_out` e o aviso da escalação anunciada (#619)", () => {
    const attack = criteria("attack_weakened_home");
    expect(attack.true).toContain(
      "`home_team.starters_left_out` includes a starting forward"
    );
    expect(attack.false).toContain(
      "`home_team.starters_left_out` has no starting forward"
    );
    const defense = criteria("defense_weakened_home");
    expect(defense.true).toContain(
      "`home_team.starters_left_out` includes a starting defender or the first-choice goalkeeper"
    );
    expect(defense.false).toContain(
      "`home_team.starters_left_out` has no starting defender and no first-choice goalkeeper"
    );
    for (const c of [attack, defense]) {
      expect(c.true).toContain(
        "Once `home_team.lineup` is announced, every player still listed in `home_team.absences` is outside the starting lineup, including doubtful ones."
      );
    }
    expect(
      (
        JUDGMENT_QUESTIONS.attack_weakened_home.instructions as {
          question: string;
        }
      ).question
    ).toBe(
      "The absences or lineup choices listed for this team remove a first-choice attacking player who is central to how the team scores."
    );
  });

  it("papéis de `starters_left_out` citados existem no que state.ts emite", () => {
    const { starters_left_out } = lineupStateFields({
      status: "announced",
      changes: "3-4",
      leftOut: [
        { position: "goalkeeper", whereabouts: "bench" },
        { position: "defender" },
        { position: "forward", whereabouts: "out_of_squad" },
      ],
    });
    expect(starters_left_out).toEqual([
      "first-choice goalkeeper (on the bench)",
      "starting defender",
      "starting forward (not in the squad)",
    ]);
    for (const role of [
      "first-choice goalkeeper",
      "starting defender",
      "starting forward",
    ]) {
      expect(starters_left_out.some((s) => s.startsWith(role))).toBe(true);
    }
  });
});
