import { describe, expect, it } from "vitest";

import {
  finalLeaksValue,
  finalizeLlmPick,
  finalizeModelPick,
  repairValueLeaks,
  templateModelPick,
} from "@/lib/ai/palpites/finalize";

const teams = { home: "Palmeiras", away: "Flamengo" };
const pick = {
  outcome: "away" as const,
  score: { home: 1, away: 2 },
  firstHalfScore: { home: 0, away: 1 },
  firstToScore: "away" as const,
};
const output = {
  verdict: "Vai dar Flamengo",
  verdictOutcome: "away" as const,
  narrative: "O Fla chega embalado e o Verdão sente a ausência do camisa 10.",
  citedMarkets: ["Resultado (1X2)"],
};

describe("finalizeModelPick", () => {
  it("placar, 1º tempo e primeiro a marcar vêm do pick; o texto do LLM fica", () => {
    const final = finalizeModelPick({ ...output, cardsTemperature: "pegado" }, pick, teams);
    expect(final.verdict).toBe(output.verdict);
    expect(final.narrative).toBe(output.narrative);
    expect(final.probableScore).toEqual(pick.score);
    expect(final.templated).toBeNull();
    const byType = new Map(final.rows.map((r) => [r.type, r]));
    expect(byType.get("exact_score")!.params).toEqual({ home: 1, away: 2 });
    expect(byType.get("first_half_score")!.params).toEqual({ home: 0, away: 1 });
    expect(byType.get("first_to_score")!.params).toEqual({ firstToScore: "away" });
    expect(byType.get("cards")!.params).toEqual({ line: 4, scope: "total" });
  });

  it("veredito incoerente → só o veredito sai do template", () => {
    const final = finalizeModelPick({ ...output, verdict: "Vai dar Palmeiras" }, pick, teams);
    expect(final.verdict).toBe("Vai dar Flamengo");
    expect(final.narrative).toBe(output.narrative);
    expect(final.templated).toMatchObject({ verdict: true, narrative: false });
  });

  it("verdictOutcome divergente → veredito de template", () => {
    const final = finalizeModelPick({ ...output, verdictOutcome: "home" }, pick, teams);
    expect(final.templated?.verdict).toBe(true);
  });
});

describe("templateModelPick e repairValueLeaks", () => {
  it("template inteiro: sem mercados citados, sem cartões, linhas do pick", () => {
    const final = templateModelPick(pick, teams, "erro do provedor");
    expect(final.templated).toEqual({ verdict: true, narrative: true, reason: "erro do provedor" });
    expect(final.citedMarkets).toEqual([]);
    expect(final.rows.some((r) => r.type === "cards")).toBe(false);
    expect(final.probableScore).toEqual(pick.score);
    expect(finalLeaksValue(final)).toBe(false);
  });

  it("só o campo que vazou troca; rótulo citado que vazou sai", () => {
    const leaky = finalizeModelPick(
      { ...output, narrative: "Tem edge no Fla.", citedMarkets: ["Resultado (1X2)", "odd do over"] },
      pick,
      teams,
    );
    expect(finalLeaksValue(leaky)).toBe(true);
    const fixed = repairValueLeaks(leaky, pick, teams);
    expect(finalLeaksValue(fixed)).toBe(false);
    expect(fixed.verdict).toBe(output.verdict);
    expect(fixed.narrative).not.toContain("edge");
    expect(fixed.citedMarkets).toEqual(["Resultado (1X2)"]);
    expect(fixed.templated).toMatchObject({ verdict: false, narrative: true });
  });
});

describe("finalizeLlmPick (v12)", () => {
  it("tudo do LLM, sem template", () => {
    const final = finalizeLlmPick({
      verdict: "Vai dar Palmeiras",
      probableScore: { home: 2, away: 0 },
      firstHalfScore: { home: 1, away: 0 },
      firstToScore: "home",
      narrative: "x",
      citedMarkets: [],
    });
    expect(final.probableScore).toEqual({ home: 2, away: 0 });
    expect(final.templated).toBeNull();
    expect(final.rows.map((r) => r.type)).toContain("margin");
  });
});
