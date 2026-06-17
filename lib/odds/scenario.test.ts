import { describe, it, expect } from "vitest";

import { formatEdge } from "@/lib/format";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  computeMarketScenarios,
  computeModelBreakEvenOdd,
  computeScenarios,
  computeSelectionEdgePp,
} from "@/lib/odds/scenario";

describe("computeEvPerUnit", () => {
  it("computes positive EV for a favorable price (58% @ 1.92)", () => {
    // Hand-computed: 0.58 × 1.92 = 1.1136 → EV = +0.1136 por unidade.
    expect(computeEvPerUnit(58, 1.92)).toBeCloseTo(0.1136, 6);
  });

  it("computes negative EV for an unfavorable price (42% @ 1.94)", () => {
    // 0.42 × 1.94 = 0.8148 → EV = −0.1852 por unidade.
    expect(computeEvPerUnit(42, 1.94)).toBeCloseTo(-0.1852, 6);
  });

  it("yields zero EV at the exact break-even (50% @ 2.00)", () => {
    expect(computeEvPerUnit(50, 2.0)).toBeCloseTo(0, 10);
  });

  it("throws on odds <= 1", () => {
    expect(() => computeEvPerUnit(58, 1)).toThrow();
    expect(() => computeEvPerUnit(58, 0.5)).toThrow();
    expect(() => computeEvPerUnit(58, -1)).toThrow();
  });

  it("throws on non-finite odds", () => {
    expect(() => computeEvPerUnit(58, NaN)).toThrow();
    expect(() => computeEvPerUnit(58, Infinity)).toThrow();
  });
});

describe("computeBreakEvenProbPct", () => {
  it("returns the raw 1/odd break-even (NOT the normalized implied)", () => {
    expect(computeBreakEvenProbPct(2.0)).toBe(50);
    // 100/1.92 = 52.083… — acima da implied normalizada do mesmo lado num
    // mercado com overround; é o conceito certo pro break-even (odd crua paga).
    expect(computeBreakEvenProbPct(1.92)).toBeCloseTo(52.0833, 4);
  });

  it("throws on odds <= 1 or non-finite", () => {
    expect(() => computeBreakEvenProbPct(1)).toThrow();
    expect(() => computeBreakEvenProbPct(0.5)).toThrow();
    expect(() => computeBreakEvenProbPct(NaN)).toThrow();
    expect(() => computeBreakEvenProbPct(Infinity)).toThrow();
  });
});

describe("computeModelBreakEvenOdd", () => {
  it("returns 100/modelProbPct (odd mínima pra sair do zero SE o modelo estiver certo)", () => {
    expect(computeModelBreakEvenOdd(42)).toBeCloseTo(2.381, 3);
    expect(computeModelBreakEvenOdd(50)).toBe(2);
    expect(computeModelBreakEvenOdd(100)).toBe(1);
  });

  it("throws on probabilities outside (0, 100] or non-finite", () => {
    expect(() => computeModelBreakEvenOdd(0)).toThrow();
    expect(() => computeModelBreakEvenOdd(-5)).toThrow();
    expect(() => computeModelBreakEvenOdd(100.1)).toThrow();
    expect(() => computeModelBreakEvenOdd(NaN)).toThrow();
  });
});

describe("computeScenarios", () => {
  it("over novo: lado recomendado usa SEMPRE os valores salvos, mesmo quando divergem do recomputado", () => {
    // Caso de precedência: edge salvo 7.35 (.toFixed(2)) vs recomputado das
    // odds 7.3505… — na exibição divergem ("+7.3" vs "+7.4"). O salvo VENCE.
    const result = computeScenarios({
      recommendation: "over",
      confidencePct: 58,
      oddAtRecommendation: 1.9,
      impliedProbPct: 50.65,
      edgePct: 7.35,
      overOdd: 1.9,
      underOdd: 1.95,
    });

    expect(result.recommended).toBe("over");
    // Salvos passam intactos — nunca recomputados.
    expect(result.over.odd).toBe(1.9);
    expect(result.over.impliedProbPct).toBe(50.65);
    expect(result.over.edgePct).toBe(7.35);
    // O recomputado de fato divergiria na exibição — pina que a divergência
    // existe e que o salvo é o exibido.
    const recomputedEdge =
      58 - computeMarketImpliedProbabilities([1.9, 1.95]).probs[0] * 100;
    expect(formatEdge(recomputedEdge)).toBe("+7.4");
    expect(formatEdge(result.over.edgePct)).toBe("+7.3");
    // Derivados do lado recomendado.
    expect(result.over.modelProbPct).toBe(58);
    expect(result.over.evPerUnit).toBeCloseTo(0.102, 6);
    expect(result.over.breakEvenProbPct).toBeCloseTo(52.6316, 4);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.7241, 4);
    // Lado oposto: derivado dos salvos (100 − x, −edge) + par congelado.
    expect(result.under.modelProbPct).toBe(42);
    expect(result.under.impliedProbPct).toBeCloseTo(49.35, 10);
    expect(result.under.edgePct).toBe(-7.35);
    expect(result.under.odd).toBe(1.95);
    expect(result.under.evPerUnit).toBeCloseTo(-0.181, 6);
    expect(result.under.breakEvenProbPct).toBeCloseTo(51.2821, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.381, 3);
  });

  it("under novo: espelha a precedência com o under recomendado", () => {
    const result = computeScenarios({
      recommendation: "under",
      confidencePct: 56,
      oddAtRecommendation: 1.85,
      impliedProbPct: 49.3,
      edgePct: 6.7,
      overOdd: 1.98,
      underOdd: 1.85,
    });

    expect(result.recommended).toBe("under");
    expect(result.under.modelProbPct).toBe(56);
    expect(result.under.impliedProbPct).toBe(49.3);
    expect(result.under.edgePct).toBe(6.7);
    expect(result.under.odd).toBe(1.85);
    expect(result.under.evPerUnit).toBeCloseTo(0.036, 6);
    expect(result.over.modelProbPct).toBe(44);
    expect(result.over.impliedProbPct).toBeCloseTo(50.7, 10);
    expect(result.over.edgePct).toBe(-6.7);
    expect(result.over.odd).toBe(1.98);
    expect(result.over.evPerUnit).toBeCloseTo(-0.1288, 6);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(2.2727, 4);
  });

  it("pass novo: implied recomputada do par congelado; edge < 5pp com EV positivo é estado legítimo", () => {
    // conf 53 @ 1.92/1.92 → edge over +3pp (abaixo do threshold → pass), mas
    // EV over = 0.53 × 1.92 − 1 = +0.0176 (ADR 0012, decisão 7).
    const result = computeScenarios({
      recommendation: "pass",
      confidencePct: 53, // convenção: prob do OVER
      oddAtRecommendation: null,
      impliedProbPct: null,
      edgePct: null,
      overOdd: 1.92,
      underOdd: 1.92,
    });

    expect(result.recommended).toBeNull();
    expect(result.over.modelProbPct).toBe(53);
    expect(result.under.modelProbPct).toBe(47);
    // Odds iguais → implied normalizada 50/50 (via computeMarketImpliedProbabilities).
    expect(result.over.impliedProbPct).toBeCloseTo(50, 10);
    expect(result.under.impliedProbPct).toBeCloseTo(50, 10);
    expect(result.over.edgePct).toBeCloseTo(3, 10);
    expect(result.under.edgePct).toBeCloseTo(-3, 10);
    expect(result.over.odd).toBe(1.92);
    expect(result.under.odd).toBe(1.92);
    expect(result.over.evPerUnit).toBeCloseTo(0.018, 2);
    expect(result.under.evPerUnit).toBeCloseTo(-0.0976, 4);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.8868, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.1277, 4);
  });

  it("histórica não-pass (par congelado null): recomendado completo via salvos; oposto sem odd/EV/break-even", () => {
    const result = computeScenarios({
      recommendation: "over",
      confidencePct: 58,
      oddAtRecommendation: 1.92,
      impliedProbPct: 50.7,
      edgePct: 7.3,
      overOdd: null,
      underOdd: null,
    });

    expect(result.recommended).toBe("over");
    // Lado recomendado completo (odd salva + derivados dela).
    expect(result.over.odd).toBe(1.92);
    expect(result.over.impliedProbPct).toBe(50.7);
    expect(result.over.edgePct).toBe(7.3);
    expect(result.over.evPerUnit).toBeCloseTo(0.1136, 6);
    expect(result.over.breakEvenProbPct).toBeCloseTo(52.0833, 4);
    // Oposto: probs/edge derivados dos salvos; resto null.
    expect(result.under.modelProbPct).toBe(42);
    expect(result.under.impliedProbPct).toBeCloseTo(49.3, 10);
    expect(result.under.edgePct).toBe(-7.3);
    expect(result.under.odd).toBeNull();
    expect(result.under.evPerUnit).toBeNull();
    expect(result.under.breakEvenProbPct).toBeNull();
    // modelBreakEvenOdd sempre derivável, mesmo sem odds.
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.381, 3);
  });

  it("histórica pass (tudo null): só prob do modelo + odd de equilíbrio do modelo", () => {
    const result = computeScenarios({
      recommendation: "pass",
      confidencePct: 51,
      oddAtRecommendation: null,
      impliedProbPct: null,
      edgePct: null,
      overOdd: null,
      underOdd: null,
    });

    expect(result.recommended).toBeNull();
    for (const side of [result.over, result.under]) {
      expect(side.impliedProbPct).toBeNull();
      expect(side.edgePct).toBeNull();
      expect(side.odd).toBeNull();
      expect(side.evPerUnit).toBeNull();
      expect(side.breakEvenProbPct).toBeNull();
    }
    expect(result.over.modelProbPct).toBe(51);
    expect(result.under.modelProbPct).toBe(49);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.9608, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.0408, 4);
  });

  it("invariantes: probs do modelo somam 100; edge do recomendado === edgePct salvo de input", () => {
    const inputs = [
      {
        recommendation: "over" as const,
        confidencePct: 58,
        oddAtRecommendation: 1.9,
        impliedProbPct: 50.65,
        edgePct: 7.35,
        overOdd: 1.9,
        underOdd: 1.95,
      },
      {
        recommendation: "under" as const,
        confidencePct: 56,
        oddAtRecommendation: 1.85,
        impliedProbPct: 49.3,
        edgePct: 6.7,
        overOdd: null,
        underOdd: null,
      },
    ];
    for (const input of inputs) {
      const result = computeScenarios(input);
      expect(result.over.modelProbPct + result.under.modelProbPct).toBe(100);
      const rec = result.recommended === "over" ? result.over : result.under;
      expect(rec.edgePct).toBe(input.edgePct);
    }
  });

  it("guarda: confidencePct fora de (0, 100) ou não-finita lança", () => {
    const base = {
      recommendation: "over" as const,
      oddAtRecommendation: 1.9,
      impliedProbPct: 50.65,
      edgePct: 7.35,
      overOdd: 1.9,
      underOdd: 1.95,
    };
    expect(() => computeScenarios({ ...base, confidencePct: 0 })).toThrow();
    expect(() => computeScenarios({ ...base, confidencePct: 100 })).toThrow();
    expect(() => computeScenarios({ ...base, confidencePct: NaN })).toThrow();
  });
});

describe("computeSelectionEdgePp", () => {
  it("returns model − implied (positive when model > implied)", () => {
    // ADR 0018 N=3: casa modelProb 52 − implied 45.4342984 = +6.5657016.
    expect(computeSelectionEdgePp(52, 45.4342984)).toBeCloseTo(6.5657016, 6);
  });

  it("returns a negative edge when implied > model", () => {
    expect(computeSelectionEdgePp(21, 26.5033408)).toBeCloseTo(-5.5033408, 6);
  });

  it("returns zero when model equals implied", () => {
    expect(computeSelectionEdgePp(50, 50)).toBe(0);
  });
});

describe("computeMarketScenarios", () => {
  it("N=3 (1X2): pina todos os campos das 3 seleções (ADR 0018)", () => {
    // Odds casa 2.10 / empate 3.40 / fora 3.60; modelProb 52 / 27 / 21.
    const { selections, recommended } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 52, odd: 2.1 },
        { key: "draw", modelProbPct: 27, odd: 3.4 },
        { key: "away", modelProbPct: 21, odd: 3.6 },
      ],
      recommendedKey: "home",
    });

    expect(recommended).toBe("home");
    expect(selections.map((s) => s.key)).toEqual(["home", "draw", "away"]);

    // implied normalizada (full-precision).
    expect(selections[0].impliedProbPct).toBeCloseTo(45.4342984, 6);
    expect(selections[1].impliedProbPct).toBeCloseTo(28.0623608, 6);
    expect(selections[2].impliedProbPct).toBeCloseTo(26.5033408, 6);

    // edge = model − implied.
    expect(selections[0].edgePct).toBeCloseTo(6.5657016, 6);
    expect(selections[1].edgePct).toBeCloseTo(-1.0623608, 6);
    expect(selections[2].edgePct).toBeCloseTo(-5.5033408, 6);

    // EV por unidade na odd CRUA.
    expect(selections[0].evPerUnit).toBeCloseTo(0.092, 6);
    expect(selections[1].evPerUnit).toBeCloseTo(-0.082, 6);
    expect(selections[2].evPerUnit).toBeCloseTo(-0.244, 6);

    // break-even (100/odd cru).
    expect(selections[0].breakEvenProbPct).toBeCloseTo(47.6190476, 6);
    expect(selections[1].breakEvenProbPct).toBeCloseTo(29.4117647, 6);
    expect(selections[2].breakEvenProbPct).toBeCloseTo(27.7777778, 6);

    // modelBreakEvenOdd = 100/modelProbPct.
    expect(selections[0].modelBreakEvenOdd).toBeCloseTo(100 / 52, 6);
    expect(selections[1].modelBreakEvenOdd).toBeCloseTo(100 / 27, 6);
    expect(selections[2].modelBreakEvenOdd).toBeCloseTo(100 / 21, 6);
  });

  it("estrutural (morte do 100−x): Σ implied ≈ 100, nenhum edge é −outro, model passa intacto", () => {
    const model = [52, 27, 21];
    const { selections } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: model[0], odd: 2.1 },
        { key: "draw", modelProbPct: model[1], odd: 3.4 },
        { key: "away", modelProbPct: model[2], odd: 3.6 },
      ],
      recommendedKey: "home",
    });

    const sumImplied = selections.reduce(
      (acc, s) => acc + (s.impliedProbPct ?? 0),
      0,
    );
    expect(sumImplied).toBeCloseTo(100, 6);

    // Nenhum par satisfaz edge_i === −edge_j (o invariante binário morreu).
    for (let i = 0; i < selections.length; i++) {
      for (let j = 0; j < selections.length; j++) {
        if (i === j) continue;
        const ei = selections[i].edgePct as number;
        const ej = selections[j].edgePct as number;
        expect(ei).not.toBe(-ej);
      }
    }

    // modelProbPct passa intacto — sem complemento derivado.
    expect(selections.map((s) => s.modelProbPct)).toEqual(model);
  });

  it("impliedSumTarget=2 (dupla chance, cobertura sobreposta): Σ implied ≈ 200, exatamente 2× o default", () => {
    // odds de dupla chance de um favorito (1X/X2/12). As 3 duplas se sobrepõem →
    // a prob real soma ~200%. impliedSumTarget=2 escala a normalização Σ=1.
    const odds = [
      { key: "home_or_draw", modelProbPct: 90, odd: 1.2 },
      { key: "away_or_draw", modelProbPct: 18, odd: 6.0 },
      { key: "home_or_away", modelProbPct: 92, odd: 1.3 },
    ];
    const scaled = computeMarketScenarios({
      selections: odds,
      recommendedKey: "home_or_draw",
      impliedSumTarget: 2,
    });
    const base = computeMarketScenarios({
      selections: odds,
      recommendedKey: "home_or_draw",
    });

    const sumScaled = scaled.selections.reduce(
      (a, s) => a + (s.impliedProbPct ?? 0),
      0,
    );
    const sumBase = base.selections.reduce(
      (a, s) => a + (s.impliedProbPct ?? 0),
      0,
    );
    expect(sumScaled).toBeCloseTo(200, 6);
    expect(sumBase).toBeCloseTo(100, 6); // default = partição, byte-idêntico

    // Cada implícita escalada é EXATAMENTE 2× a default → o de-vig só multiplica.
    scaled.selections.forEach((s, i) => {
      expect(s.impliedProbPct as number).toBeCloseTo(
        (base.selections[i].impliedProbPct as number) * 2,
        9,
      );
    });

    // edge = modelProb honesto − implícita escalada (ambos na escala Σ≈200).
    scaled.selections.forEach((s) => {
      expect(s.edgePct as number).toBeCloseTo(
        s.modelProbPct - (s.impliedProbPct as number),
        9,
      );
    });
  });

  it("marketKind=independent_binary (scorer): implícita-TETO (1/odd)*100, SEM normalização", () => {
    // 3 jogadores yes-only: odds 2.5/4.0/5.0; modelProb 52/28/18. A implícita-teto
    // por jogador é (1/odd)*100 e NÃO normaliza (Σ pode passar de 100). Casa com o
    // edge-teto persistido pelo predict (não o caminho Σ=1 de partição).
    const { selections } = computeMarketScenarios({
      selections: [
        { key: "scorer_a", modelProbPct: 52, odd: 2.5 },
        { key: "scorer_b", modelProbPct: 28, odd: 4.0 },
        { key: "scorer_c", modelProbPct: 18, odd: 5.0 },
      ],
      recommendedKey: "scorer_a",
      marketKind: "independent_binary",
    });
    expect(selections[0].impliedProbPct).toBeCloseTo(40, 9); // 1/2.5*100
    expect(selections[1].impliedProbPct).toBeCloseTo(25, 9); // 1/4.0*100
    expect(selections[2].impliedProbPct).toBeCloseTo(20, 9); // 1/5.0*100
    // edge = modelProb − teto (PISO conservador).
    expect(selections[0].edgePct).toBeCloseTo(12, 9);
    // Σ teto = 85, NÃO normalizado a 100 (binários independentes).
    const sum = selections.reduce((a, s) => a + (s.impliedProbPct ?? 0), 0);
    expect(sum).toBeCloseTo(85, 9);
  });

  it("partition (default) vs independent_binary divergem: o default NORMALIZA, o scorer não", () => {
    const sel = [
      { key: "a", modelProbPct: 50, odd: 2.0 },
      { key: "b", modelProbPct: 50, odd: 2.0 },
    ];
    const partition = computeMarketScenarios({ selections: sel, recommendedKey: "a" });
    const scorer = computeMarketScenarios({
      selections: sel,
      recommendedKey: "a",
      marketKind: "independent_binary",
    });
    // partition: Σ=100 (50/50). scorer: cada teto = 50, Σ=100 aqui POR ACASO (odd 2.0),
    // mas a derivação é diferente — em odds desbalanceadas elas divergem.
    expect(partition.selections[0].impliedProbPct).toBeCloseTo(50, 9);
    expect(scorer.selections[0].impliedProbPct).toBeCloseTo(50, 9);
  });

  it("N=3 com recommendedKey=null (nenhuma seleção recomendada — echo)", () => {
    const { selections, recommended } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 34, odd: 2.1 },
        { key: "draw", modelProbPct: 33, odd: 3.4 },
        { key: "away", modelProbPct: 33, odd: 3.6 },
      ],
      recommendedKey: null,
    });

    expect(recommended).toBeNull();
    // Implícitas/edge ainda computadas (todas as odds presentes).
    expect(selections[0].impliedProbPct).toBeCloseTo(45.4342984, 6);
    expect(selections.every((s) => s.edgePct !== null)).toBe(true);
  });

  it("ecoa recommendedKey fielmente mesmo quando discorda do ranking de edge (echo, não derivação)", () => {
    // home carrega o MAIOR edge (+6.57); ainda assim recommendedKey aponta draw
    // (edge −1.06). Uma implementação que derivasse a recomendação do max-edge
    // devolveria "home" e falharia — trava o contrato de echo (ADR 0018 dec.2:
    // o gatilho edge≥MIN_EDGE_PP é do LLM/prompt, não desta função pura).
    const { selections, recommended } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 52, odd: 2.1 },
        { key: "draw", modelProbPct: 27, odd: 3.4 },
        { key: "away", modelProbPct: 21, odd: 3.6 },
      ],
      recommendedKey: "draw",
    });

    expect(recommended).toBe("draw");
    // sanity: home realmente tem edge maior que draw — logo "draw" só veio do echo.
    expect(
      (selections[0].edgePct as number) > (selections[1].edgePct as number),
    ).toBe(true);
  });

  it("mercado parcial (uma odd ausente): implied/edge null em TODAS; model/odd-de-equilíbrio retidos", () => {
    const { selections } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 52, odd: 2.1 },
        { key: "draw", modelProbPct: 27, odd: null },
        { key: "away", modelProbPct: 21, odd: 3.6 },
      ],
      recommendedKey: "home",
    });

    for (const s of selections) {
      expect(s.impliedProbPct).toBeNull();
      expect(s.edgePct).toBeNull();
    }
    // modelProbPct e modelBreakEvenOdd seguem derivando.
    expect(selections.map((s) => s.modelProbPct)).toEqual([52, 27, 21]);
    expect(selections[0].modelBreakEvenOdd).toBeCloseTo(100 / 52, 6);
    expect(selections[1].modelBreakEvenOdd).toBeCloseTo(100 / 27, 6);
    // EV/break-even seguem a odd crua por seleção (null só onde a odd falta).
    expect(selections[0].evPerUnit).toBeCloseTo(0.092, 6);
    expect(selections[1].evPerUnit).toBeNull();
    expect(selections[1].breakEvenProbPct).toBeNull();
    expect(selections[2].evPerUnit).toBeCloseTo(-0.244, 6);
  });

  it("seleção com modelProbPct=0 não lança: modelBreakEvenOdd dela vira null, as demais derivam", () => {
    // MatchResultOutputSchema permite prob 0; uma row reaberta com model_prob_pct
    // null vira 0 no boundary (Number(null) = 0). 100/0 é indefinido — degrada pra
    // null em vez de derrubar a view N-vias (computeModelBreakEvenOdd lançaria).
    expect(() =>
      computeMarketScenarios({
        selections: [
          { key: "home", modelProbPct: 60, odd: 1.8 },
          { key: "draw", modelProbPct: 40, odd: 3.0 },
          { key: "away", modelProbPct: 0, odd: 9.0 },
        ],
        recommendedKey: "home",
      }),
    ).not.toThrow();

    const { selections } = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 60, odd: 1.8 },
        { key: "draw", modelProbPct: 40, odd: 3.0 },
        { key: "away", modelProbPct: 0, odd: 9.0 },
      ],
      recommendedKey: "home",
    });

    // A seleção de prob 0 degrada modelBreakEvenOdd pra null…
    expect(selections[2].modelBreakEvenOdd).toBeNull();
    // …mas modelProbPct/odd/EV/break-even dela seguem derivando.
    expect(selections[2].modelProbPct).toBe(0);
    expect(selections[2].evPerUnit).toBeCloseTo(0 * 9 - 1, 6);
    expect(selections[2].breakEvenProbPct).toBeCloseTo(100 / 9, 6);
    // As outras seleções não são afetadas.
    expect(selections[0].modelBreakEvenOdd).toBeCloseTo(100 / 60, 6);
    expect(selections[1].modelBreakEvenOdd).toBeCloseTo(100 / 40, 6);
  });
});
