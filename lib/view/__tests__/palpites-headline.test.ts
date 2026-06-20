import { describe, expect, it } from "vitest";

import type { PalpiteHeadline } from "@/db/schema";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";
import {
  PALPITE_DISCLAIMER,
  toDimensionViews,
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

// ─── PALPITE_DISCLAIMER (rótulo regulatório estático, ADR 0031 §5 / #376) ──────

describe("PALPITE_DISCLAIMER", () => {
  it("existe, é não-vazio e é firewall-clean (containsValueLanguage === false)", () => {
    expect(typeof PALPITE_DISCLAIMER).toBe("string");
    expect(PALPITE_DISCLAIMER.length).toBeGreaterThan(0);
    // O disclaimer estático NUNCA pode carregar linguagem de valor (firewall leg b/c).
    expect(containsValueLanguage(PALPITE_DISCLAIMER)).toBe(false);
  });
});

describe("toPalpiteHeadlineView", () => {
  it("mapeia verdict/probableScore/confidence/narrative/citedMarkets; badge null quando pendente; dimensions vazio por default", () => {
    const v = toPalpiteHeadlineView(source());
    expect(v).toEqual({
      verdict: "Vai dar Flamengo",
      probableScore: { home: 2, away: 1 },
      confidence: "alta",
      narrative: "O Fla vem voando em casa.",
      citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
      badge: null,
      dimensions: [],
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

  it("#378: thread headline.sources → view.sources quando presente (tool output, render verbatim)", () => {
    const sources = [
      { title: "Palmeiras confirma escalação", url: "https://ge.globo.com/a" },
      { title: "Verdão vem embalado em casa", url: "https://espn.com.br/b" },
    ];
    const v = toPalpiteHeadlineView(source({ headline: { ...headline, sources } }));
    expect(v.sources).toEqual(sources);
  });

  it("#378: view.sources é undefined quando a manchete não carrega sources (sets pré-#377)", () => {
    // O fixture `headline` não tem sources → o passthrough rende undefined (seção escondida).
    expect(toPalpiteHeadlineView(source()).sources).toBeUndefined();
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

// Helpers de linhas settleable não-exact_score (dimensões da ficha).
function dimLine(over: Partial<SetLine> & Pick<SetLine, "id" | "type" | "text">): SetLine {
  return {
    palpiteSetId: "set-1",
    params: null,
    settleable: true,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    outcome: null,
    ...over,
  };
}

describe("toPalpiteHeadlineViewFromSet", () => {
  it("set persistido → view (manchete + placar provável da linha exact_score); dimensions vazio sem outras rows", () => {
    expect(toPalpiteHeadlineViewFromSet(setWith())).toEqual({
      verdict: "Vai dar Flamengo",
      probableScore: { home: 2, away: 1 },
      confidence: "alta",
      narrative: "O Fla vem voando em casa.",
      citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
      badge: null,
      dimensions: [],
    });
  });

  it("#354: dimensões settleable não-exact_score mapeiam pra `dimensions` (label do text, badge do outcome); exact_score NÃO entra", () => {
    const v = toPalpiteHeadlineViewFromSet(
      setWith({
        lines: [
          line(),
          dimLine({ id: "m", type: "margin", text: "Mandante ganha por 2+" }),
          dimLine({
            id: "fh",
            type: "first_half_score",
            text: "1º tempo: 1–0",
            outcome: { result: "won" },
          }),
          dimLine({
            id: "ft",
            type: "first_to_score",
            text: "Mandante marca primeiro",
            outcome: { result: "lost" },
          }),
        ],
      }),
    );
    expect(v?.dimensions).toEqual([
      { label: "Mandante ganha por 2+", badge: null },
      { label: "1º tempo: 1–0", badge: "won" },
      { label: "Mandante marca primeiro", badge: "lost" },
    ]);
    // exact_score continua sendo a manchete, fora de dimensions.
    expect(v?.dimensions.some((d) => d.label.includes("provável"))).toBe(false);
    // Firewall: nenhum número de valor nos labels.
    const serialized = JSON.stringify(v?.dimensions);
    for (const term of ["edge", "ev", "stake", "odd", "yield", "R$", "%"]) {
      expect(serialized.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("#378: sources da manchete do set atravessam pro view (mapper do set herda o passthrough)", () => {
    const sources = [
      { title: "Flamengo confirma time titular", url: "https://ge.globo.com/fla" },
    ];
    const v = toPalpiteHeadlineViewFromSet(
      setWith({ headline: { ...headline, sources } }),
    );
    expect(v?.sources).toEqual(sources);
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

  it("#354 / minor K: fresh (toDimensionViews sobre rows em memória) == reload (toPalpiteHeadlineViewFromSet) — sem glitch", () => {
    const lines = [
      line(),
      dimLine({ id: "m", type: "margin", text: "Mandante ganha por 2+" }),
      dimLine({ id: "fh", type: "first_half_score", text: "1º tempo: 1–0" }),
    ];
    // Fresh: as rows recém-geradas têm outcome=null.
    const fresh = toDimensionViews(lines);
    // Reload: o mesmo set persistido (outcome=null ainda) → dimensions iguais.
    const reload = toPalpiteHeadlineViewFromSet(setWith({ lines }))?.dimensions;
    expect(fresh).toEqual(reload);
  });
});
