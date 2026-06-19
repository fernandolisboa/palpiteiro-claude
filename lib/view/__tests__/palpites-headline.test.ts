import { describe, expect, it } from "vitest";

import type { PalpiteHeadline } from "@/db/schema";
import {
  toPalpiteHeadlineView,
  type PalpiteHeadlineSource,
} from "@/lib/view/palpites-headline";

// headline POVOADO de propósito + uma proveniência cheia: a asserção-chave é que
// sourcePredictionIds (interno) NÃO atravessa pra view, e que NENHUM número de valor
// aparece. Espelha o guard de lib/view/__tests__/palpites.test.ts (aiCall nunca vaza).
const headline: PalpiteHeadline = {
  verdict: "Vai dar Flamengo",
  confidence: "alta",
  narrative: "O Fla vem voando em casa.",
  citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
  sourcePredictionIds: ["pred-1", "pred-2", "pred-3"],
};

function source(
  over: Partial<PalpiteHeadlineSource> = {},
): PalpiteHeadlineSource {
  return {
    headline,
    probableScore: { home: 2, away: 1 },
    outcome: null,
    ...over,
  };
}

describe("toPalpiteHeadlineView", () => {
  it("mapeia verdict/probableScore/confidence/narrative/citedMarkets; badge null quando pendente", () => {
    const v = toPalpiteHeadlineView(source());
    expect(v).toEqual({
      verdict: "Vai dar Flamengo",
      probableScore: { home: 2, away: 1 },
      confidence: "alta",
      narrative: "O Fla vem voando em casa.",
      citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
      badge: null,
    });
  });

  it("badge = outcome.result quando liquidado (won/lost)", () => {
    expect(toPalpiteHeadlineView(source({ outcome: { result: "won" } })).badge).toBe(
      "won",
    );
    expect(
      toPalpiteHeadlineView(source({ outcome: { result: "lost" } })).badge,
    ).toBe("lost");
  });

  it("NÃO vaza sourcePredictionIds nem nenhum número de valor (firewall leg c)", () => {
    const v = toPalpiteHeadlineView(source({ outcome: { result: "won" } }));
    const serialized = JSON.stringify(v);
    expect(serialized).not.toContain("sourcePredictionIds");
    expect(serialized).not.toContain("pred-1");
    // Estruturalmente: a view não tem chave de valor.
    for (const k of ["edgePct", "ev", "evPerUnit", "stakeUnits", "oddAtRecommendation", "yield"]) {
      expect(k in v).toBe(false);
    }
    expect("sourcePredictionIds" in v).toBe(false);
  });
});
