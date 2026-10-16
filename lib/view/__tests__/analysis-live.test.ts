import { describe, expect, it } from "vitest";

import { summarizeSavedAnalysesForSynthesis } from "@/lib/ai/palpites/synthesis-input";
import type {
  DbPrediction,
  PredictionWithAiCall,
} from "@/lib/db/queries/predictions";
import { formatAnalysisEngine } from "@/lib/format";
import { liveStampFromState } from "@/lib/live/stamp";
import {
  toAnalysisView,
  toMarketAnalysisSections,
  toPreviousAnalysisItems,
} from "@/lib/view/analysis";

// Leituras ao vivo na página do jogo (#594, PLAN-580 §11): separadas da análise de
// pré-jogo, com o selo do momento, sem odd e com a seleção decidida marcada.

const AT = new Date("2026-05-19T20:05:00Z");
const LIVE_MV =
  "claude-sonnet-4-5-20250929;engine=code_jev;lambda=dixon_coles;live=live_model_v1";

function stamp(
  score: { home: number; away: number } = { home: 1, away: 0 },
  minute = 63
) {
  return liveStampFromState(
    {
      statusShort: "2H",
      elapsed: minute,
      extra: null,
      minuteLabel: `${minute}'`,
      score,
      red: { home: 0, away: 0 },
      fetchedAt: AT,
    },
    AT
  );
}

function mkRow(o: {
  id: string;
  marketKey: string;
  createdAt: Date;
  live?: boolean;
}): PredictionWithAiCall {
  return {
    prediction: {
      id: o.id,
      recommendation: "pass",
      confidencePct: "55.00",
      rationale: "r",
      keyFactors: ["a"],
      minimumOdd: null,
      oddAtRecommendation: null,
      bookmaker: null,
      impliedProbPct: null,
      edgePct: null,
      modelVersion: o.live ? LIVE_MV : "claude-opus-4-8",
      promptVersion: o.live ? "narrator_live_v1" : "v1",
      createdAt: o.createdAt,
      marketParams: null,
      stakeUnits: null,
      judgments: null,
      isLive: o.live === true,
      liveState: o.live ? stamp() : null,
    } as unknown as DbPrediction,
    aiCall: null,
    marketKey: o.marketKey,
    selections: [],
  };
}

const HISTORY = [
  mkRow({
    id: "live2",
    marketKey: "match_result",
    createdAt: new Date(2026, 4, 19, 20, 10),
    live: true,
  }),
  mkRow({
    id: "live1",
    marketKey: "match_result",
    createdAt: new Date(2026, 4, 19, 20, 0),
    live: true,
  }),
  mkRow({
    id: "pre2",
    marketKey: "match_result",
    createdAt: new Date(2026, 4, 19, 15, 0),
  }),
  mkRow({
    id: "pre1",
    marketKey: "match_result",
    createdAt: new Date(2026, 4, 19, 14, 0),
  }),
];

describe("seções: pré-jogo e ao vivo separados", () => {
  it("o default lê só o pré-jogo: uma leitura ao vivo nunca esconde a análise de antes do apito", () => {
    expect(toMarketAnalysisSections(HISTORY).map((s) => s.id)).toEqual([
      "pre2",
    ]);
  });

  it("live: true → a última leitura ao vivo de cada mercado, com o selo", () => {
    const live = toMarketAnalysisSections(
      HISTORY,
      new Date(),
      undefined,
      undefined,
      {
        live: true,
      }
    );
    expect(live.map((s) => s.id)).toEqual(["live2"]);
    expect(live[0].view.liveLabel).toBe("ao vivo · 63' · 1–0");
  });

  it("anteriores: cada lado tem o seu mais novo fora da lista", () => {
    expect(toPreviousAnalysisItems(HISTORY).map((i) => i.id)).toEqual([
      "live1",
      "pre1",
    ]);
  });

  it("a síntese de pré-jogo não lê leitura ao vivo, e a ao vivo não lê pré-jogo", () => {
    expect(
      summarizeSavedAnalysesForSynthesis(HISTORY).map((s) => s.predictionId)
    ).toEqual(["pre2"]);
    expect(
      summarizeSavedAnalysesForSynthesis(HISTORY, { live: true }).map(
        (s) => s.predictionId
      )
    ).toEqual(["live2"]);
  });
});

describe("toAnalysisView ao vivo", () => {
  it("over/under ao vivo vai pro N-vias (sem o binário congelado) e marca o lado decidido", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "100.00",
        rationale: "Aos 63', 2–1: a linha de 2,5 já foi.",
        keyFactors: ["a", "b"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: LIVE_MV,
        promptVersion: "narrator_live_v1",
        createdAt: AT,
        marketKey: "over_under",
        line: 2.5,
        selections: [
          { key: "over", modelProbPct: 100, odd: null },
          { key: "under", modelProbPct: 0, odd: null },
        ],
        isLive: true,
        liveState: stamp({ home: 2, away: 1 }),
      },
      null
    );
    expect(view.recommendation).toBeNull();
    expect(view.liveLabel).toBe("ao vivo · 63' · 2–1");
    expect(view.outcomes.map((o) => [o.id, o.decided === true])).toEqual([
      ["over", true],
      ["under", true],
    ]);
    expect(view.framing).toBeNull();
    expect(view.engine).toBe("Código · modelo ao vivo");
  });

  it("decidido vem do placar do carimbo, não da prob. arredondada: 3–0 aos 88', empate a 0,00% não está decidido", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "100.00",
        rationale: "Aos 88', 3–0.",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: LIVE_MV,
        promptVersion: "narrator_live_v1",
        createdAt: AT,
        marketKey: "match_result",
        selections: [
          { key: "home", modelProbPct: 100, odd: null },
          { key: "draw", modelProbPct: 0, odd: null },
          { key: "away", modelProbPct: 0, odd: null },
        ],
        isLive: true,
        liveState: stamp({ home: 3, away: 0 }, 88),
      },
      null
    );
    // O 1X2 nunca está decidido antes do fim (decidedOutcome), por mais que arredonde.
    expect(view.outcomes.some((o) => o.decided)).toBe(false);
  });

  it("btts com os dois marcando: decidido pelo placar mesmo com prob. não exata", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "99.99",
        rationale: "r",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: LIVE_MV,
        promptVersion: "narrator_live_v1",
        createdAt: AT,
        marketKey: "btts",
        selections: [
          { key: "yes", modelProbPct: 99.99, odd: null },
          { key: "no", modelProbPct: 0.01, odd: null },
        ],
        isLive: true,
        liveState: stamp({ home: 1, away: 1 }),
      },
      null
    );
    expect(view.outcomes.map((o) => [o.id, o.decided === true])).toEqual([
      ["yes", true],
      ["no", true],
    ]);
  });

  it("carimbo ilegível ainda mostra 'ao vivo'", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "40.00",
        rationale: "r",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: LIVE_MV,
        promptVersion: "narrator_live_v1",
        createdAt: AT,
        marketKey: "btts",
        selections: [
          { key: "yes", modelProbPct: 40, odd: null },
          { key: "no", modelProbPct: 60, odd: null },
        ],
        isLive: true,
        liveState: { broken: true },
      },
      null
    );
    expect(view.liveLabel).toBe("ao vivo");
    expect(view.outcomes.some((o) => o.decided)).toBe(false);
  });

  it("pré-jogo segue sem liveLabel nem decided", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "55.00",
        rationale: "r",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: "claude-opus-4-8",
        promptVersion: "v1",
        createdAt: AT,
      },
      null
    );
    expect("liveLabel" in view).toBe(false);
    expect(view.outcomes.every((o) => !("decided" in o))).toBe(true);
  });
});

describe("formatAnalysisEngine", () => {
  it("a tag live= vira 'Código · modelo ao vivo'; sem ela, nada muda", () => {
    expect(formatAnalysisEngine(LIVE_MV, null)).toBe("Código · modelo ao vivo");
    expect(
      formatAnalysisEngine(
        "claude-sonnet-4-5-20250929;engine=code_jev;lambda=dixon_coles",
        null
      )
    ).toBe("Código + JEV");
  });
});
