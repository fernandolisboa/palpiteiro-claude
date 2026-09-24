import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeEvPerUnit, computeMarketScenarios } from "@/lib/odds/scenario";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { Prediction } from "@/lib/ai/predict";
import type { FanOutOutcome } from "@/lib/ai/best-bet";

import { toBestBetView } from "@/lib/view/best-bet";

// Minimal-but-valid prediction row stub (numeric cols are Drizzle strings).
function makePrediction(overrides: Partial<Prediction>): Prediction {
  return {
    recommendation: "home",
    confidencePct: "55",
    rationale: "porque sim",
    keyFactors: ["a", "b"],
    minimumOdd: "1.80",
    oddAtRecommendation: "1.90",
    bookmaker: "Bet365",
    impliedProbPct: "52.00",
    edgePct: "3.00",
    modelVersion: "claude-x",
    promptVersion: "match_result_v1",
    createdAt: new Date("2026-06-15T00:00:00Z"),
    marketParams: null,
    stakeUnits: "1",
    aiCallId: "ai-1",
    ...overrides,
  } as unknown as Prediction;
}

const sel = (key: string, modelProbPct: number, odd: number | null) => ({
  key,
  modelProbPct,
  odd,
});

const ok = (
  marketKey: string,
  selections: { key: string; modelProbPct: number; odd: number | null }[],
  predOverrides: Partial<Prediction>,
): FanOutOutcome => ({
  ok: true,
  marketKey,
  result: {
    prediction: makePrediction({ marketKey, ...predOverrides } as Partial<Prediction>),
    marketKey,
    selections,
  },
});

const mr = (over: Partial<Prediction> = {}) =>
  ok(
    "match_result",
    [sel("home", 55, 1.9), sel("draw", 25, 3.5), sel("away", 20, 4.2)],
    { recommendation: "home", confidencePct: "55", oddAtRecommendation: "1.90", ...over },
  );

describe("toBestBetView — rank LÊ os números que o card mostra (#178)", () => {
  it("Number() boundary: numeric strings → números no rank", () => {
    const view = toBestBetView([mr()], new Map());
    const r = view.entries[0].rank;
    expect(r.confidencePct).toBe(55);
    expect(r.oddAtRecommendation).toBe(1.9);
    expect(typeof r.confidencePct).toBe("number");
  });

  it("edge do rank === edge da seleção recomendada via computeMarketScenarios (NÃO o edgePct persistido)", () => {
    const selections = [sel("home", 55, 1.9), sel("draw", 25, 3.5), sel("away", 20, 4.2)];
    const expectedEdge = computeMarketScenarios({
      selections,
      recommendedKey: "home",
      impliedSumTarget: 1,
    }).selections.find((s) => s.key === "home")!.edgePct;

    // edgePct persistido é deliberadamente ABSURDO — o rank NÃO pode usá-lo.
    const view = toBestBetView([mr({ edgePct: "99.99" })], new Map());
    expect(view.entries[0].rank.edgePct).toBeCloseTo(expectedEdge!, 6);
    expect(view.entries[0].rank.edgePct).not.toBeCloseTo(99.99, 1);
  });

  it("EV do rank === computeEvPerUnit(confidencePct, oddAtRecommendation), NÃO edge×odd", () => {
    const view = toBestBetView([mr()], new Map());
    const expectedEv = computeEvPerUnit(55, 1.9);
    expect(view.entries[0].rank.evPerUnit).toBeCloseTo(expectedEv, 6);
    // edge×odd seria um número diferente — guarda contra a regressão do plano.
    const edge = view.entries[0].rank.edgePct!;
    expect(view.entries[0].rank.evPerUnit).not.toBeCloseTo(edge * 1.9, 4);
  });

  it("impliedSumTarget vem do descriptor (1 partição, 2 dupla chance)", () => {
    const dc = ok(
      "double_chance",
      [sel("home_or_draw", 70, 1.25), sel("home_or_away", 60, 1.5), sel("away_or_draw", 55, 1.7)],
      { recommendation: "home_or_draw", confidencePct: "70", oddAtRecommendation: "1.25" },
    );
    const view = toBestBetView([mr(), dc], new Map());
    const byKey = Object.fromEntries(view.entries.map((e) => [e.marketKey, e.rank]));
    expect(byKey["match_result"].impliedSumTarget).toBe(1);
    expect(byKey["double_chance"].impliedSumTarget).toBe(2);
  });

  it("pass → edge/EV null, isPass true", () => {
    const pass = ok("match_result", [sel("home", 40, 1.9), sel("draw", 30, 3.5), sel("away", 30, 4.0)], {
      recommendation: "pass",
      oddAtRecommendation: null,
    });
    const view = toBestBetView([pass], new Map());
    expect(view.entries[0].rank).toMatchObject({ edgePct: null, evPerUnit: null, isPass: true });
  });

  it("marketLabel vem da presentation", () => {
    const view = toBestBetView([mr()], new Map());
    expect(view.entries[0].marketLabel).toBe(getMarketPresentation("match_result").marketLabel);
  });

  it("llmCalls = entries.length; unavailableMarkets = errors.length", () => {
    const fail: FanOutOutcome = { ok: false, marketKey: "btts", message: "Nenhum bookmaker oferece este mercado" };
    const view = toBestBetView([mr(), fail], new Map());
    expect(view.llmCalls).toBe(1);
    expect(view.unavailableMarkets).toBe(1);
    expect(view.errors[0]).toMatchObject({
      marketKey: "btts",
      marketLabel: getMarketPresentation("btts").marketLabel,
      message: "Nenhum bookmaker oferece este mercado",
    });
  });

  it("dedup de erros: mercado que virou entry NÃO conta como indisponível; pré-warm + predict do mesmo mercado contam 1×", () => {
    // double_chance falhou no pré-warm E no predict → 1 erro só.
    const dcFail: FanOutOutcome = { ok: false, marketKey: "double_chance", message: "sem snapshot fresco" };
    const preWarm = [
      { marketKey: "double_chance", message: "pré-warm falhou" },
      // match_result "falhou" no pré-warm mas o predict deu certo → não é indisponível.
      { marketKey: "match_result", message: "pré-warm falhou" },
    ];
    const view = toBestBetView([mr(), dcFail], new Map(), preWarm);
    expect(view.llmCalls).toBe(1);
    expect(view.unavailableMarkets).toBe(1);
    expect(view.errors.map((e) => e.marketKey)).toEqual(["double_chance"]);
  });

  it("notRunErrors (#492, sem slot) entram DEPOIS das falhas de predict e contam como indisponíveis", () => {
    const bttsFail: FanOutOutcome = { ok: false, marketKey: "btts", message: "sem snapshot fresco" };
    const notRun = [{ marketKey: "double_chance", message: "Limite diário atingido — não analisado." }];
    const view = toBestBetView([mr(), bttsFail], new Map(), [], notRun);
    expect(view.llmCalls).toBe(1);
    expect(view.unavailableMarkets).toBe(2);
    expect(view.errors.map((e) => e.marketKey)).toEqual(["btts", "double_chance"]);
    expect(view.errors[1]).toMatchObject({
      marketLabel: getMarketPresentation("double_chance").marketLabel,
      message: "Limite diário atingido — não analisado.",
    });
  });
});

describe("toBestBetView — bundle safety (server-side mapper, painel só recebe o tipo)", () => {
  it("o módulo NÃO faz import de valor de @/lib/db nem @/lib/ai (só import type)", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/view/best-bet.ts"),
      "utf8",
    );
    // Nenhum import de @/lib/db.
    expect(/from\s+["']@\/lib\/db/.test(src)).toBe(false);
    // Imports de @/lib/ai só na forma `import type` (apagados no bundle).
    const aiImports = src.match(/^import\s+(type\s+)?.*from\s+["']@\/lib\/ai.*$/gm) ?? [];
    expect(aiImports.length).toBeGreaterThan(0);
    for (const line of aiImports) expect(line).toMatch(/^import\s+type\s/);
  });
});
