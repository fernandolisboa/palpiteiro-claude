import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  computeMarketScenarios,
} from "@/lib/odds/scenario";
import * as impliedProbability from "@/lib/odds/implied-probability";
import { computeStakeUnits } from "@/lib/ai/staking";

import {
  toGradeMyBetView,
  type GradeMyBetMapperInput,
} from "@/lib/view/grade-my-bet";

const sel = (key: string, modelProbPct: number, odd: number | null) => ({
  key,
  modelProbPct,
  odd,
});

// over/under board completo (NOSSAS odds de snapshot).
const OU_SELECTIONS = [sel("over", 58, 1.92), sel("under", 42, 1.95)];

function input(over: Partial<GradeMyBetMapperInput>): GradeMyBetMapperInput {
  return {
    selections: OU_SELECTIONS,
    pinnedKey: "over",
    userOdd: 2.0,
    marketKey: "over_under",
    line: 2.5,
    recommendation: null,
    persisted: null,
    createdAt: "20/06/2026 12:00",
    ...over,
  };
}

describe("toGradeMyBet — canal odd-do-usuário (price-only, ADR 0034 §2/§3)", () => {
  it("EV exibido = computeEvPerUnit(modelProbPct_pinned, userOdd) DIRETO, ≠ EV@nossaOdd", () => {
    const view = toGradeMyBetView(input({ userOdd: 2.0 }));
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    expect(view.evPerUnit).toBeCloseTo(computeEvPerUnit(58, 2.0), 9);
    // EV na NOSSA odd (1.92) é um número diferente — guarda contra reusar o card.
    expect(view.evPerUnit).not.toBeCloseTo(computeEvPerUnit(58, 1.92), 4);
    expect(view.breakEvenProbPct).toBeCloseTo(computeBreakEvenProbPct(2.0), 9);
  });

  it("userOdd NUNCA entra no array Σ1/odd de computeMarketImpliedProbabilities", () => {
    const spy = vi.spyOn(impliedProbability, "computeMarketImpliedProbabilities");
    toGradeMyBetView(input({ userOdd: 99.0 }));
    // Toda chamada vê SÓ as nossas odds [1.92, 1.95] — nunca a 99.0 do usuário.
    for (const call of spy.mock.calls) {
      expect(call[0]).not.toContain(99.0);
      expect(call[0]).toEqual([1.92, 1.95]);
    }
    spy.mockRestore();
  });

  it("edge ancorado no NOSSO board (recompute via computeMarketScenarios) na não-recomendada", () => {
    const view = toGradeMyBetView(input({ recommendation: "under" }));
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    const expected = computeMarketScenarios({
      selections: OU_SELECTIONS,
      recommendedKey: "under",
      impliedSumTarget: 1,
      marketKind: "partition",
    }).selections.find((s) => s.key === "over")!.edgePct!;
    expect(view.edge).toBeCloseTo(expected, 9);
  });
});

describe("toGradeMyBet — persisted-vs-recompute (mesmo número p/ edge E stake)", () => {
  it("pinned===recommendation E persisted!=null → usa edge E stake PERSISTIDOS", () => {
    const view = toGradeMyBetView(
      input({
        pinnedKey: "over",
        recommendation: "over",
        persisted: { edgePct: 7.35, impliedProbPct: 50.65, stakeUnits: 2 },
      }),
    );
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    expect(view.edge).toBe(7.35);
    expect(view.impliedProbPct).toBe(50.65);
    expect(view.stakeUnits).toBe(2); // o PERSISTIDO, não o recomputado
    expect(view.edgeLabel).toBe(`+${(7.35).toFixed(1)}pp`);
  });

  it("não-recomendada → edge E stake RECOMPUTADOS do mesmo número", () => {
    const view = toGradeMyBetView(input({ recommendation: "under" }));
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    const expectedEdge = computeMarketScenarios({
      selections: OU_SELECTIONS,
      recommendedKey: "under",
      impliedSumTarget: 1,
      marketKind: "partition",
    }).selections.find((s) => s.key === "over")!.edgePct!;
    expect(view.edge).toBeCloseTo(expectedEdge, 9);
    expect(view.stakeUnits).toBe(computeStakeUnits(expectedEdge, 58));
  });
});

describe("toGradeMyBet — guarda de coerência (§4c)", () => {
  it("sign(EV@userOdd) negativo E edge@ourOdd positivo → valueReading negativo + stake demovido", () => {
    // Snapshot com edge POSITIVO no over (modelProb alto vs implícita), mas a odd do
    // usuário é baixa o suficiente pra EV@userOdd < 0.
    const selections = [sel("over", 58, 1.92), sel("under", 42, 1.95)];
    // EV@userOdd: (58/100)*1.6 - 1 = -0.072 < 0; edge no board é positivo.
    const view = toGradeMyBetView(
      input({ selections, recommendation: "under", userOdd: 1.6 }),
    );
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    expect(view.evPerUnit).toBeLessThan(0);
    expect(view.edge).not.toBeNull();
    expect(view.edge! > 0).toBe(true);
    expect(view.coherenceWarning).toBe(true);
    expect(view.valueReading).toContain("não tem valor");
    // O stake-de-nosso-edge sai SÓ como secundário, nunca como manchete.
    expect(view.secondaryStakeLabel).not.toBeNull();
    expect(view.stakeLabel).toBe("dimensionamento de mercado");
  });
});

describe("toGradeMyBet — degradado sem snapshot + nao-avalio", () => {
  it("não-recomendada + odd ausente no board → degradado-sem-snapshot (edge='—', EV+lucro presentes, 1u)", () => {
    const selections = [sel("over", 58, null), sel("under", 42, null)];
    const view = toGradeMyBetView(
      input({ selections, recommendation: "under", userOdd: 2.0 }),
    );
    expect(view.kind).toBe("degradado-sem-snapshot");
    if (view.kind !== "degradado-sem-snapshot") return;
    expect(view.edgeLabel).toBe("—");
    expect(view.stakeUnits).toBe(1);
    expect(view.stakeLabel).toBe("dimensionamento de mercado");
    expect(view.evPerUnit).toBeCloseTo(computeEvPerUnit(58, 2.0), 9);
    expect(view.profitIfWon).toBeCloseTo(1 * (2.0 - 1), 9);
  });

  it("seleção fixada ausente da distribuição → nao-avalio (skip-not-fabricate §8)", () => {
    const view = toGradeMyBetView(input({ pinnedKey: "ghost" }));
    expect(view.kind).toBe("nao-avalio");
  });
});

describe("toGradeMyBet — impliedSumTarget threadado (dupla chance Σ=2)", () => {
  it("double_chance: edge NÃO pela metade (impliedSumTarget=2 do descriptor)", () => {
    const selections = [
      sel("home_or_draw", 70, 1.25),
      sel("home_or_away", 60, 1.5),
      sel("away_or_draw", 55, 1.7),
    ];
    const view = toGradeMyBetView(
      input({
        selections,
        pinnedKey: "home_or_draw",
        recommendation: "away_or_draw",
        marketKey: "double_chance",
        line: null,
        userOdd: 1.3,
      }),
    );
    if (view.kind !== "grade-coberto") throw new Error(view.kind);
    const expected = computeMarketScenarios({
      selections,
      recommendedKey: "away_or_draw",
      impliedSumTarget: 2,
      marketKind: "partition",
    }).selections.find((s) => s.key === "home_or_draw")!.edgePct!;
    expect(view.edge).toBeCloseTo(expected, 9);
  });
});

describe("toGradeMyBet — value-reading register (golden, §10/§11)", () => {
  const READINGS = new Set<string>();
  for (const ev of [2.0, 1.7241379, 1.5]) {
    // userOdd > / ≈ / < break-even do over → positivo / zero / negativo.
    const v = toGradeMyBetView(input({ userOdd: ev, recommendation: "over", persisted: null }));
    if (v.kind === "grade-coberto" || v.kind === "degradado-sem-snapshot") {
      READINGS.add(v.valueReading);
    }
  }

  it("render ∈ conjunto FINITO de constantes (≤3)", () => {
    expect(READINGS.size).toBeLessThanOrEqual(3);
    expect(READINGS.size).toBeGreaterThan(0);
  });

  it("NENHUMA constante carrega imperativo/nota/score/superlativo (denylist)", () => {
    const DENY =
      /\b(aposte|vá|garante|garantido|boa aposta|ótima|excelente|péssima|recomendamos|recomendo|melhor aposta)\b/i;
    const GRADE = /\b([A-F][+-]?|nota|score|\d+\/10|\d+ de 100)\b/;
    for (const r of READINGS) {
      expect(r).not.toMatch(DENY);
      expect(r).not.toMatch(GRADE);
    }
  });
});

describe("firewall + não-compartilhável (import-graph, ADR 0034 §9/§13)", () => {
  const root = join(__dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");

  // Casa o IMPORT statement (não a palavra solta num comentário): o módulo MENCIONA
  // 'value-language-guard' nos comentários de invariante, mas nunca o IMPORTA.
  const importsGuard = (src: string) =>
    /from\s+["'][^"']*value-language-guard["']/.test(src);
  const importsLibDb = (src: string) =>
    /from\s+["']@\/lib\/db["']|from\s+["']@\/lib\/db\//.test(src);

  it("grade-my-bet.ts NÃO importa value-language-guard nem @/lib/db nem @/lib/ai/palpites", () => {
    const src = read("lib/view/grade-my-bet.ts");
    expect(importsGuard(src)).toBe(false);
    expect(importsLibDb(src)).toBe(false);
    // @/lib/ai/staking é permitido; @/lib/ai/palpites (manchete) NÃO.
    expect(/from\s+["']@\/lib\/ai\/palpites/.test(src)).toBe(false);
  });

  it("grade-my-bet-input.ts NÃO importa value-language-guard nem @/lib/db", () => {
    const src = read("lib/view/grade-my-bet-input.ts");
    expect(importsGuard(src)).toBe(false);
    expect(importsLibDb(src)).toBe(false);
  });

  it("grade-my-bet.tsx NÃO importa value-language-guard", () => {
    const src = read("components/grade-my-bet.tsx");
    expect(importsGuard(src)).toBe(false);
  });

  it("grade-my-bet.tsx renderiza o disclaimer §3 COMPLETO verbatim (tela de máxima intenção)", () => {
    const src = read("components/grade-my-bet.tsx");
    expect(src).toContain("Aposta não é investimento.");
    expect(src).toContain("não garantem resultado");
    expect(src).toContain("nunca para recuperar perdas");
    expect(src).toContain(
      "Se a aposta deixou de ser diversão, procure ajuda.",
    );
  });

  it("NENHUM módulo sob app/p/** importa grade-my-bet (não vaza valor pro OG público)", () => {
    const files = [
      "app/p/[id]/page.tsx",
      "app/p/[id]/opengraph-image.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toContain("grade-my-bet");
      expect(src).not.toContain("match-analysis-tabs");
    }
  });
});
