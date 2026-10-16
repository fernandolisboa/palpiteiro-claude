import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildLivePalpitesInput,
  buildLiveUserMessage,
  checkLiveFidelity,
  likelyFinalScores,
  LIVE_SYSTEM_PROMPT,
  PALPITES_LIVE_VERSION,
  palpitesLiveCartridge,
  PalpitesLiveOutputSchema,
  SUBMIT_LIVE_PALPITE_TOOL,
} from "@/lib/ai/palpites/cartridges/live";
import { getPalpiteCartridge } from "@/lib/ai/palpites/registry";
import { buildLivePalpiteRows } from "@/lib/ai/palpites/settleable-rows";
import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

// palpites_live_v1 (#594): a manchete com o jogo rolando. Puro.

const BOOKMAKER_NAME =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Matriz FINAL condicionada de brinquedo, já a partir de 1–0.
const CELLS: number[][] = [
  [0, 0, 0],
  [0.4, 0.15, 0.05],
  [0.25, 0.1, 0.05],
];

const analyses: MarketAnalysisSummary[] = [
  {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "pass",
    recommendedLabel: null,
    isPass: true,
    modelProbPct: null,
    edgePct: null,
    confidencePct: null,
    oddAtRecommendation: null,
    rationale: "Leitura ao vivo.",
    predictionId: "p-1",
    selections: [
      { key: "home", modelProbPct: 70 },
      { key: "draw", modelProbPct: 20 },
      { key: "away", modelProbPct: 10 },
    ],
  },
];

const input = buildLivePalpitesInput({
  match: { league: "Brasileirão", homeTeam: "Flamengo", awayTeam: "Fluminense" },
  situation: { moment: "aos 63'", score: { home: 1, away: 0 }, red: { home: 0, away: 0 } },
  matrix: { cells: CELLS },
  analyses,
});

const output = {
  verdict: "O Flamengo segura a vantagem",
  probableScore: { home: 1, away: 0 },
  confidence: "media" as const,
  narrative: "Aos 63', com 1 a 0, o Fla tem 70% de chance de vencer.",
  citedMarkets: ["Resultado (1X2)"],
};

describe("palpites_live_v1 — cartucho", () => {
  it("versão própria; o cartucho de pré-jogo segue o mesmo", () => {
    expect(PALPITES_LIVE_VERSION).toBe("palpites_live_v1");
    expect(palpitesLiveCartridge.version).toBe("palpites_live_v1");
    expect(getPalpiteCartridge().version).not.toBe(PALPITES_LIVE_VERSION);
  });

  it("prompt fixado (mudou? bump + commit prompt:)", () => {
    expect(sha(LIVE_SYSTEM_PROMPT)).toMatchInlineSnapshot(`"a9bb6e99c672cfc1"`);
    expect(sha(JSON.stringify(SUBMIT_LIVE_PALPITE_TOOL))).toMatchInlineSnapshot(`"bd477e0ae920d41f"`);
  });

  it("sem nome de casa no prompt, na ferramenta nem na mensagem", () => {
    expect(BOOKMAKER_NAME.test(LIVE_SYSTEM_PROMPT)).toBe(false);
    expect(BOOKMAKER_NAME.test(JSON.stringify(SUBMIT_LIVE_PALPITE_TOOL))).toBe(false);
    expect(BOOKMAKER_NAME.test(buildLiveUserMessage(input))).toBe(false);
  });

  it("output .strict(): sem 1º tempo, primeiro a marcar nem cartões", () => {
    expect(PalpitesLiveOutputSchema.safeParse(output).success).toBe(true);
    for (const extra of [
      { firstHalfScore: { home: 1, away: 0 } },
      { firstToScore: "home" },
      { cardsTemperature: "pegado" },
    ]) {
      expect(PalpitesLiveOutputSchema.safeParse({ ...output, ...extra }).success).toBe(
        false,
      );
    }
    expect(Object.keys(SUBMIT_LIVE_PALPITE_TOOL.input_schema.properties)).toEqual([
      "verdict",
      "probableScore",
      "confidence",
      "narrative",
      "citedMarkets",
    ]);
  });

  it("mensagem: situação do jogo e placares finais prováveis; sem número de valor", () => {
    const msg = buildLiveUserMessage(input);
    expect(msg).toContain("# Situação do jogo");
    expect(msg).toContain("- Momento: aos 63'");
    expect(msg).toContain("- Placar: Flamengo 1 × 0 Fluminense");
    expect(msg).toContain("- 1–0: 40,0%");
    // Só a tarefa nomeia os termos proibidos; os dados não carregam número de valor.
    const data = msg.slice(0, msg.indexOf("# Sua tarefa"));
    expect(data).not.toMatch(/\bedge\b|\bodds?\b|R\$/i);
  });
});

describe("likelyFinalScores", () => {
  it("ordena do mais ao menos provável e ignora células zeradas", () => {
    expect(likelyFinalScores(CELLS, 3)).toEqual([
      { home: 1, away: 0, probPct: 40 },
      { home: 2, away: 0, probPct: 25 },
      { home: 1, away: 1, probPct: 15 },
    ]);
    expect(likelyFinalScores(CELLS).every((s) => s.home >= 1)).toBe(true);
  });
});

describe("checkLiveFidelity", () => {
  it("aceita percentuais da leitura e dos placares prováveis", () => {
    expect(checkLiveFidelity(output, input).ok).toBe(true);
    expect(
      checkLiveFidelity({ ...output, narrative: "1–0 tem 40% de chance." }, input).ok,
    ).toBe(true);
  });

  it("recusa percentual inventado", () => {
    const res = checkLiveFidelity({ ...output, narrative: "O Fla tem 88% de chance." }, input);
    expect(res.ok).toBe(false);
  });

  it("contagem de gols tem que ser um lado do placar atual", () => {
    expect(
      checkLiveFidelity({ ...output, narrative: "Com 1 gol marcado, o Fla segura." }, input)
        .ok,
    ).toBe(true);
    expect(
      checkLiveFidelity({ ...output, narrative: "Com 3 gols marcados, o Fla segura." }, input)
        .ok,
    ).toBe(false);
  });

  it("linguagem de valor na saída é pega pelo guard de conteúdo", () => {
    expect(containsValueLanguage("o Fla tem edge, olha as odds")).toBe(true);
    expect(containsValueLanguage(`${output.verdict} ${output.narrative}`)).toBe(false);
  });
});

describe("buildLivePalpiteRows", () => {
  it("só exact_score/margin/clean_sheet, nunca 1º tempo ou primeiro a marcar", () => {
    const rows = buildLivePalpiteRows("set-1", { probableScore: { home: 3, away: 0 } });
    expect(rows.map((r) => r.type).sort()).toEqual(
      ["clean_sheet", "exact_score", "margin"].sort(),
    );
    expect(rows.every((r) => r.palpiteSetId === "set-1")).toBe(true);
    const tight = buildLivePalpiteRows("s", { probableScore: { home: 1, away: 1 } });
    expect(tight.map((r) => r.type)).toEqual(["exact_score"]);
  });
});
