import { describe, expect, it } from "vitest";

import {
  JUDGMENT_QUESTION_IDS,
  JUDGMENT_QUESTIONS,
  JUDGMENTS_VERSION,
} from "../questions";

describe("jev_judgments_v1", () => {
  it("versão e as 8 perguntas noul", () => {
    expect(JUDGMENTS_VERSION).toBe("jev_judgments_v1");
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
        "The absences listed for this team remove a first-choice defender or the first-choice goalkeeper.",
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
});
