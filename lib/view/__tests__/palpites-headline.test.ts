import { describe, expect, it } from "vitest";

import type { PalpiteHeadline } from "@/db/schema";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";
import {
  toPalpiteHeadlineView,
  toPalpiteHeadlineViewFromSet,
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

// ─── toPalpiteHeadlineViewFromSet (mapper do set persistido) ──────────────────

type SetLine = PalpiteSetWithLines["palpites"][number];

function line(over: Partial<SetLine> = {}): SetLine {
  return {
    id: "line-1",
    palpiteSetId: "set-1",
    type: "exact_score",
    text: "2 a 1 pro mandante",
    params: { home: 2, away: 1 },
    settleable: true,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    outcome: null,
    ...over,
  };
}

function setWith(
  over: { headline?: PalpiteHeadline | null; lines?: SetLine[] } = {},
): PalpiteSetWithLines {
  return {
    palpiteSet: {
      id: "set-1",
      matchId: "match-1",
      userId: "user-1",
      aiCallId: null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v2",
      headline: over.headline === undefined ? headline : over.headline,
      createdAt: new Date("2026-06-01T12:00:00Z"),
    },
    aiCall: null,
    palpites: over.lines ?? [line()],
  };
}

describe("toPalpiteHeadlineViewFromSet", () => {
  it("set persistido → view (manchete + placar provável da linha exact_score)", () => {
    expect(toPalpiteHeadlineViewFromSet(setWith())).toEqual({
      verdict: "Vai dar Flamengo",
      probableScore: { home: 2, away: 1 },
      confidence: "alta",
      narrative: "O Fla vem voando em casa.",
      citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
      badge: null,
    });
  });

  it("headline null (set antigo pré-#353) → null", () => {
    expect(toPalpiteHeadlineViewFromSet(setWith({ headline: null }))).toBeNull();
  });

  it("sem linha exact_score → null", () => {
    const onlyFun = setWith({
      lines: [line({ type: "red_card", params: null, settleable: false })],
    });
    expect(toPalpiteHeadlineViewFromSet(onlyFun)).toBeNull();
  });

  it("linha exact_score sem params → null", () => {
    const noParams = setWith({ lines: [line({ params: null })] });
    expect(toPalpiteHeadlineViewFromSet(noParams)).toBeNull();
  });

  it("outcome settled (won/lost) da linha → badge", () => {
    expect(
      toPalpiteHeadlineViewFromSet(
        setWith({ lines: [line({ outcome: { result: "won" } })] }),
      )?.badge,
    ).toBe("won");
    expect(
      toPalpiteHeadlineViewFromSet(
        setWith({ lines: [line({ outcome: { result: "lost" } })] }),
      )?.badge,
    ).toBe("lost");
  });
});
