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
      const no = JUDGMENT_QUESTIONS[id].criteria.false;
      expect(no).toContain("An absence listed only as `player (...)`");
      expect(no).toContain(
        "has an unknown role and does not by itself make the statement true"
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
    // A regra do em dúvida com a escalação anunciada vale igual no true e no false.
    for (const c of [attack, defense]) {
      for (const text of [c.true, c.false]) {
        expect(text).toContain(
          "Once `home_team.lineup` is announced, a doubtful player still listed in `home_team.absences` is not starting and counts like an injured one."
        );
      }
      expect(c.true).toContain(
        'While `home_team.lineup` is "not announced", a doubtful starting'
      );
      // Entrada de posição desconhecida em starters_left_out.
      expect(c.false).toContain(
        "an entry of `home_team.starters_left_out` listed as `starting player`, has an unknown role"
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

  it("os criteria citam todo o vocabulário de escalação que state.ts emite (#619)", () => {
    const allCriteria = Object.values(JUDGMENT_QUESTIONS)
      .map((q) => {
        const c = q.criteria as Criteria;
        return `${c.true} ${c.false}`;
      })
      .join(" ");
    // Todo valor de `lineup`, tirado do emissor (lineupStateFields).
    const lineupValues = [
      lineupStateFields({ status: "not_announced" }).lineup,
      lineupStateFields({ status: "announced", changes: null, leftOut: [] })
        .lineup,
      ...(["0-2", "3-4", "5+"] as const).map(
        (changes) =>
          lineupStateFields({ status: "announced", changes, leftOut: [] })
            .lineup
      ),
    ];
    expect(new Set(lineupValues).size).toBe(5);
    for (const value of lineupValues) {
      expect(allCriteria).toContain(`"${value}"`);
    }
    // Papéis de `starters_left_out` que algum critério lê (meia não pesa em nenhum
    // fator, como meia em `absences`), também tirados do emissor.
    const roles = lineupStateFields({
      status: "announced",
      changes: "3-4",
      leftOut: [
        { position: "goalkeeper" },
        { position: "defender" },
        { position: "forward" },
        {},
      ],
    }).starters_left_out;
    expect(roles).toEqual([
      "first-choice goalkeeper",
      "starting defender",
      "starting forward",
      "starting player",
    ]);
    for (const role of roles) {
      expect(allCriteria).toContain(role);
    }
  });
});
