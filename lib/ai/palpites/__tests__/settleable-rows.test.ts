import { describe, expect, it } from "vitest";

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import { buildSettleablePalpiteRows } from "@/lib/ai/palpites/settleable-rows";
import type { PalpiteSynthesisOutput } from "@/lib/ai/palpites/cartridges/cartridge";

function output(
  over: Partial<PalpiteSynthesisOutput> = {},
): PalpiteSynthesisOutput {
  return {
    verdict: "Vai dar mandante",
    probableScore: { home: 2, away: 0 },
    firstHalfScore: { home: 1, away: 0 },
    firstToScore: "home",
    confidence: "media",
    narrative: "narrativa qualquer",
    citedMarkets: [],
    ...over,
  };
}

function rowsFor(over: Partial<PalpiteSynthesisOutput> = {}) {
  return buildSettleablePalpiteRows("set-1", output(over));
}

function byType(rows: ReturnType<typeof rowsFor>) {
  return new Map(rows.map((r) => [r.type, r]));
}

describe("buildSettleablePalpiteRows — strings derivadas (golden, templates FIXOS)", () => {
  it("emite todas as 5 dimensões coerentes com strings EXATAS", () => {
    // 2-0, HT 1-0, marca home → margem 2 (>=2), clean sheet home, 1º tempo 1-0, home 1º.
    const rows = rowsFor();
    const m = byType(rows);
    expect(m.get("exact_score")?.text).toBe("Placar provável: 2–0");
    expect(m.get("margin")?.text).toBe("Mandante ganha por 2+");
    expect(m.get("clean_sheet")?.text).toBe("Mandante não sofre gol");
    expect(m.get("first_half_score")?.text).toBe("1º tempo: 1–0");
    expect(m.get("first_to_score")?.text).toBe("Mandante marca primeiro");
  });

  it("lado VISITANTE: strings EXATAS + params do lado away", () => {
    // 0-2, HT 0-1, away marca → margem 2 (>=2) pro away, clean sheet away (home zera),
    // 1º tempo 0-1, away 1º. Pina o ramo "Visitante" dos templates (o golden anterior
    // só cobria "Mandante").
    const rows = rowsFor({
      probableScore: { home: 0, away: 2 },
      firstHalfScore: { home: 0, away: 1 },
      firstToScore: "away",
    });
    const m = byType(rows);
    expect(m.get("exact_score")?.text).toBe("Placar provável: 0–2");
    expect(m.get("margin")?.text).toBe("Visitante ganha por 2+");
    expect(m.get("clean_sheet")?.text).toBe("Visitante não sofre gol");
    expect(m.get("first_half_score")?.text).toBe("1º tempo: 0–1");
    expect(m.get("first_to_score")?.text).toBe("Visitante marca primeiro");
    // params do lado away.
    expect(m.get("margin")?.params).toEqual({ side: "away", minMargin: 2 });
    expect(m.get("clean_sheet")?.params).toEqual({ side: "away" });
    expect(m.get("first_to_score")?.params).toEqual({ firstToScore: "away" });
  });

  it("params por tipo são o shape esperado", () => {
    const m = byType(rowsFor());
    expect(m.get("exact_score")?.params).toEqual({ home: 2, away: 0 });
    expect(m.get("margin")?.params).toEqual({ side: "home", minMargin: 2 });
    expect(m.get("clean_sheet")?.params).toEqual({ side: "home" });
    expect(m.get("first_half_score")?.params).toEqual({ home: 1, away: 0 });
    expect(m.get("first_to_score")?.params).toEqual({ firstToScore: "home" });
  });

  it("settleable=true em todas + palpiteSetId fluído", () => {
    for (const r of rowsFor()) {
      expect(r.settleable).toBe(true);
      expect(r.palpiteSetId).toBe("set-1");
    }
  });

  it("NENHUM text contém linguagem de valor (firewall)", () => {
    for (const r of rowsFor()) {
      expect(containsValueLanguage(r.text)).toBe(false);
    }
  });
});

describe("buildSettleablePalpiteRows — emissão condicional (gates de coerência)", () => {
  it("floor de margin >=2: vitória por 1 (2-1) NÃO emite margin", () => {
    const m = byType(rowsFor({ probableScore: { home: 2, away: 1 }, firstHalfScore: { home: 1, away: 0 } }));
    expect(m.has("margin")).toBe(false);
  });

  it("floor de margin >=2: vitória por 1 (1-0) NÃO emite margin", () => {
    const m = byType(rowsFor({ probableScore: { home: 1, away: 0 }, firstHalfScore: { home: 0, away: 0 } }));
    expect(m.has("margin")).toBe(false);
  });

  it("empate previsto NÃO emite margin nem clean_sheet", () => {
    const m = byType(
      rowsFor({
        probableScore: { home: 1, away: 1 },
        firstHalfScore: { home: 0, away: 0 },
        firstToScore: "none",
      }),
    );
    expect(m.has("margin")).toBe(false);
    expect(m.has("clean_sheet")).toBe(false);
  });

  it("ambos marcam previsto (3-1) NÃO emite clean_sheet", () => {
    const m = byType(
      rowsFor({ probableScore: { home: 3, away: 1 }, firstHalfScore: { home: 1, away: 0 } }),
    );
    expect(m.has("clean_sheet")).toBe(false); // away marcou 1 → mandante NÃO fica zerado
    // mas margin SIM (|3-1|=2 >= 2)
    expect(m.has("margin")).toBe(true);
  });

  it("first_half_score incoerente (> probableScore num lado) → PULA a row", () => {
    const m = byType(
      rowsFor({ probableScore: { home: 1, away: 0 }, firstHalfScore: { home: 2, away: 0 } }),
    );
    expect(m.has("first_half_score")).toBe(false);
  });

  it("first_to_score 'none' NUNCA emite row", () => {
    const m = byType(
      rowsFor({ probableScore: { home: 0, away: 0 }, firstHalfScore: { home: 0, away: 0 }, firstToScore: "none" }),
    );
    expect(m.has("first_to_score")).toBe(false);
  });

  it("first_to_score que discorda do vencedor implícito → PULA", () => {
    // probableScore 2-0 (home vence) mas firstToScore 'away' → incoerente, pula.
    const m = byType(
      rowsFor({ probableScore: { home: 2, away: 0 }, firstHalfScore: { home: 1, away: 0 }, firstToScore: "away" }),
    );
    expect(m.has("first_to_score")).toBe(false);
  });

  it("empate previsto (1-1) com firstToScore 'home' → NÃO emite first_to_score (vencedor indefinido no empate)", () => {
    // Sob placar provável de empate o vencedor implícito é undefined → o gate de
    // coerência (winnerAgrees) reprova qualquer firstToScore → row pulada.
    const m = byType(
      rowsFor({
        probableScore: { home: 1, away: 1 },
        firstHalfScore: { home: 0, away: 0 },
        firstToScore: "home",
      }),
    );
    expect(m.has("first_to_score")).toBe(false);
  });

  it("exact_score é SEMPRE emitido", () => {
    expect(byType(rowsFor({ probableScore: { home: 1, away: 1 }, firstHalfScore: { home: 0, away: 0 }, firstToScore: "none" })).has("exact_score")).toBe(true);
  });
});
