import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

import { PALPITES_VERSION, SYSTEM_PROMPT } from "../cartridge";
import {
  PalpitesModelPickOutputSchema,
  SUBMIT_PALPITE_V13_TOOL,
  SYSTEM_PROMPT_V13,
  buildModelPickInput,
  buildModelPickUserMessage,
  palpitesModelPickCartridge,
  type BuildModelPickInputArgs,
} from "../model-pick";

// palpites_v13 (#668, ADR 0072): o LLM escreve o texto do palpite decidido em código.

const BOOKMAKER_NAME =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const valid = {
  verdict: "Vai dar Fluminense",
  verdictOutcome: "away",
  narrative: "O Flu vem melhor e o Fla sente os desfalques.",
  citedMarkets: ["Resultado (1X2)"],
};

function fixture(home: string, away: string, sh: number, sa: number): NormalizedFixture {
  return {
    id: `${home}:${away}`,
    league: "brasileirao_a",
    kickoffAt: "2026-05-10T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-10T19:00:00.000Z"),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: sh, away: sa },
  };
}

function analysis(over: Partial<MarketAnalysisSummary>): MarketAnalysisSummary {
  return {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "home",
    recommendedLabel: "Casa",
    isPass: false,
    modelProbPct: 38,
    edgePct: 3.6,
    confidencePct: 38,
    oddAtRecommendation: 2.9,
    rationale: "Preço do mandante acima do justo.",
    predictionId: "p-mr",
    selections: [{ key: "home", modelProbPct: 38 }],
    ...over,
  };
}

function args(): BuildModelPickInputArgs {
  return {
    match: {
      league: "brasileirao_a" as never,
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
    },
    fixture: undefined,
    homeForm: [fixture("CR Flamengo", "X", 1, 1)],
    awayForm: [fixture("Fluminense FC", "Z", 2, 0)],
    h2h: [],
    standings: undefined,
    analyses: [
      analysis({}),
      analysis({
        marketKey: "over_under",
        marketLabel: "Mais/Menos gols",
        recommendation: "over",
        recommendedLabel: "Mais de 2,5 gols",
        rationale: "Times que marcam.",
        predictionId: "p-ou",
      }),
      analysis({
        marketKey: "btts",
        marketLabel: "Ambas marcam",
        recommendation: "pass",
        recommendedLabel: null,
        isPass: true,
        rationale: "",
        predictionId: "p-btts",
      }),
    ],
    pick: {
      outcome: "away",
      score: { home: 1, away: 2 },
      firstHalfScore: { home: 0, away: 1 },
      firstToScore: "away",
      probs: { home: 31.2, draw: 27.4, away: 41.4 },
    },
    confidence: "media",
    factors: ["Desfalques tiram do mandante uma peça ofensiva central — sinal forte"],
  };
}

describe("PalpitesModelPickOutputSchema", () => {
  it("aceita o texto válido (cardsTemperature opcional)", () => {
    expect(PalpitesModelPickOutputSchema.safeParse(valid).success).toBe(true);
    expect(
      PalpitesModelPickOutputSchema.safeParse({ ...valid, cardsTemperature: "pegado" }).success,
    ).toBe(true);
  });

  it("rejeita probableScore/firstHalfScore/firstToScore (decididos em código) e chaves de valor", () => {
    for (const extra of [
      { probableScore: { home: 1, away: 2 } },
      { firstHalfScore: { home: 0, away: 1 } },
      { firstToScore: "away" },
      { confidence: "alta" },
      { edgePct: 3 },
    ]) {
      expect(PalpitesModelPickOutputSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it("verdictOutcome é obrigatório e do enum", () => {
    const { verdictOutcome, ...without } = valid;
    void verdictOutcome;
    expect(PalpitesModelPickOutputSchema.safeParse(without).success).toBe(false);
    expect(
      PalpitesModelPickOutputSchema.safeParse({ ...valid, verdictOutcome: "visitante" }).success,
    ).toBe(false);
  });
});

describe("cartucho palpites_v13", () => {
  it("versão, ferramenta e schema", () => {
    expect(PALPITES_VERSION).toBe("palpites_v13");
    expect(palpitesModelPickCartridge.version).toBe("palpites_v13");
    expect(palpitesModelPickCartridge.toolName).toBe("submit_palpite");
    const props = Object.keys(SUBMIT_PALPITE_V13_TOOL.input_schema.properties).sort();
    expect(props).toEqual([
      "cardsTemperature",
      "citedMarkets",
      "narrative",
      "verdict",
      "verdictOutcome",
    ]);
    expect([...SUBMIT_PALPITE_V13_TOOL.input_schema.required].sort()).toEqual([
      "citedMarkets",
      "narrative",
      "verdict",
      "verdictOutcome",
    ]);
  });

  it("system prompt estático, sem 'azarão', sem nome de casa; difere do v12", () => {
    expect(SYSTEM_PROMPT_V13.toLowerCase()).not.toMatch(/azar[ãa]o/);
    expect(BOOKMAKER_NAME.test(SYSTEM_PROMPT_V13)).toBe(false);
    expect(BOOKMAKER_NAME.test(JSON.stringify(SUBMIT_PALPITE_V13_TOOL))).toBe(false);
    expect(SYSTEM_PROMPT_V13).not.toBe(SYSTEM_PROMPT);
    // Nada por pedido no system/tool (ADR 0071): sem nome de time nem data.
    expect(SYSTEM_PROMPT_V13).not.toMatch(/Flamengo|Fluminense|20\d\d-/);
  });

  it("prompt fixado (mudou? bump + commit prompt:)", () => {
    expect(sha(SYSTEM_PROMPT_V13)).toMatchInlineSnapshot(`"375f7914d90b8cb9"`);
    expect(sha(JSON.stringify(SUBMIT_PALPITE_V13_TOOL))).toMatchInlineSnapshot(`"627be51454f4962e"`);
  });
});

describe("buildModelPickUserMessage", () => {
  const input = buildModelPickInput(args());
  const msg = buildModelPickUserMessage(input, { daysToKickoff: 3 });

  it("bloco do palpite fixado com resultado, placar e as três chances com nomes", () => {
    expect(msg).toContain("# Palpite fixado");
    expect(msg).toContain("- Resultado: vitória do Fluminense FC (visitante)");
    expect(msg).toContain('- verdictOutcome: "away"');
    expect(msg).toContain("- Placar provável: CR Flamengo 1–2 Fluminense FC");
    expect(msg).toContain("- Placar do 1º tempo: 0–1");
    expect(msg).toContain("- Primeiro a marcar: Fluminense FC");
    expect(msg).toContain(
      "vitória do CR Flamengo 31.2%, empate 27.4%, vitória do Fluminense FC 41.4%",
    );
    expect(msg).toContain("- Confiança do palpite: média");
    expect(msg).toContain("Desfalques tiram do mandante");
  });

  it("análises: 'a análise destacou' nos outros mercados; o 1X2 sem recomendação nem racional; sem edge/odd", () => {
    expect(msg).toContain("- Resultado (1X2): considerado no palpite fixado acima.");
    expect(msg).not.toContain("Preço do mandante acima do justo.");
    expect(msg).toContain('- Mais/Menos gols: a análise destacou "Mais de 2,5 gols".');
    expect(msg).toContain("  Racional: Times que marcam.");
    expect(msg).toContain("- Ambas marcam: nada se destacou.");
    // "preço" só na proibição da tarefa, nunca como insumo (vazava pro texto).
    expect(msg.match(/\bpreços?\b/gi) ?? []).toHaveLength(1);
    expect(msg).toMatch(/NUNCA cite chances, porcentagens, preço,/);
    // Nenhum número de edge/odd (as palavras só aparecem na proibição da tarefa).
    expect(msg).not.toMatch(/\bedge -?[0-9]/i);
    expect(msg).not.toMatch(/[0-9]pp\b/);
    expect(msg).not.toMatch(/\bodd [0-9]/i);
    expect(msg).not.toContain("2.90");
    expect(msg).not.toMatch(/recomenda "/);
    expect(BOOKMAKER_NAME.test(msg)).toBe(false);
  });

  it("os fatos do jogo seguem as mesmas seções do v12", () => {
    expect(msg).toContain("# Jogo");
    expect(msg).toContain("# Mandante — CR Flamengo");
    expect(msg).toContain("# Confrontos diretos (H2H)");
    expect(msg).toContain("# Notícias recentes (fontes reais)");
  });

  it("input inválido (pick fora do schema) falha no boundary", () => {
    expect(() =>
      buildModelPickInput({
        ...args(),
        pick: { ...args().pick, outcome: "visitante" as never },
      }),
    ).toThrow();
  });
});
