import { describe, expect, it } from "vitest";

import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

import {
  PALPITES_VERSION,
  PalpitesOutputSchema,
  SUBMIT_PALPITE_TOOL,
  buildPredictionInput,
  buildUserMessage,
  palpitesCartridge,
  type BuildPalpitesInputArgs,
} from "../cartridge";
import { deriveSettleable } from "../../settleable";

// ─── PalpitesOutputSchema (a MANCHETE, v2) ────────────────────────────────────

const validHeadline = {
  verdict: "Vai dar Flamengo",
  probableScore: { home: 2, away: 1 },
  confidence: "alta" as const,
  narrative: "O Fla vem voando em casa e o Flu sofre fora.",
  citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
};

describe("PalpitesOutputSchema (síntese v2)", () => {
  it("aceita uma manchete válida", () => {
    const parsed = PalpitesOutputSchema.safeParse(validHeadline);
    expect(parsed.success).toBe(true);
  });

  it("aceita citedMarkets vazio", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      ...validHeadline,
      citedMarkets: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("aceita o caso all-pass (manchete derivada de forma/tabela)", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      verdict: "Jogo equilibrado, leve favoritismo da casa",
      probableScore: { home: 1, away: 1 },
      confidence: "baixa",
      narrative: "Sem destaque claro nos mercados; aposto num empate apertado.",
      citedMarkets: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("confidence aceita só baixa/media/alta (enum qualitativo, nunca número)", () => {
    for (const confidence of ["baixa", "media", "alta"]) {
      expect(
        PalpitesOutputSchema.safeParse({ ...validHeadline, confidence }).success,
      ).toBe(true);
    }
    for (const bad of ["high", "70", 70, "altíssima"]) {
      expect(
        PalpitesOutputSchema.safeParse({ ...validHeadline, confidence: bad })
          .success,
      ).toBe(false);
    }
  });

  it("rejeita probableScore faltando / negativo / não-inteiro / >20", () => {
    expect(
      PalpitesOutputSchema.safeParse({
        verdict: "x",
        confidence: "media",
        narrative: "y",
        citedMarkets: [],
      }).success,
    ).toBe(false);
    for (const probableScore of [
      { home: -1, away: 0 },
      { home: 1.5, away: 0 },
      { home: 21, away: 0 },
    ]) {
      expect(
        PalpitesOutputSchema.safeParse({ ...validHeadline, probableScore })
          .success,
      ).toBe(false);
    }
  });

  it("rejeita verdict / narrative vazios", () => {
    expect(
      PalpitesOutputSchema.safeParse({ ...validHeadline, verdict: "" }).success,
    ).toBe(false);
    expect(
      PalpitesOutputSchema.safeParse({ ...validHeadline, narrative: "" }).success,
    ).toBe(false);
  });

  it(".strict() rejeita uma CHAVE DE VALOR parasita (firewall leg a)", () => {
    for (const valueKey of [
      { edgePct: 8 },
      { ev: 0.12 },
      { stakeUnits: 2 },
      { oddAtRecommendation: 1.85 },
      { extra: "x" },
    ]) {
      const parsed = PalpitesOutputSchema.safeParse({
        ...validHeadline,
        ...valueKey,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("NÃO produz/aceita as chaves do MIX antigo (palpites array, red_card/corners)", () => {
    // O schema da manchete não tem `palpites` — o shape do MIX é rejeitado.
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "x", params: { home: 1, away: 1 } },
        { type: "red_card", text: "y" },
      ],
    });
    expect(parsed.success).toBe(false);
    // E uma manchete VÁLIDA não carrega red_card/corners em nenhum lugar.
    const ok = PalpitesOutputSchema.safeParse(validHeadline);
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(JSON.stringify(ok.data)).not.toContain("red_card");
      expect(JSON.stringify(ok.data)).not.toContain("corners");
    }
  });

  it("trunca verdict >280 (prose-tolerante, não rejeita)", () => {
    const long = "a".repeat(400);
    const parsed = PalpitesOutputSchema.safeParse({
      ...validHeadline,
      verdict: long,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.verdict.length).toBe(280);
      expect(parsed.data.verdict.endsWith("…")).toBe(true);
    }
  });

  it("trunca narrative >600 (prose-tolerante)", () => {
    const long = "b".repeat(800);
    const parsed = PalpitesOutputSchema.safeParse({
      ...validHeadline,
      narrative: long,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.narrative.length).toBe(600);
    }
  });
});

// ─── deriveSettleable (só exact_score liquida — Tier 3 de pé) ──────────────────

describe("deriveSettleable", () => {
  it("exact_score → true; red_card/corners → false (enum preservado, não gerado)", () => {
    expect(deriveSettleable("exact_score")).toBe(true);
    expect(deriveSettleable("red_card")).toBe(false);
    expect(deriveSettleable("corners")).toBe(false);
  });
});

// ─── tool shape ───────────────────────────────────────────────────────────────

describe("SUBMIT_PALPITE_TOOL", () => {
  it("o cartucho expõe o ToolDef neutro com o mesmo nome (submit_palpite)", () => {
    expect(palpitesCartridge.toolName).toBe("submit_palpite");
    expect(palpitesCartridge.tool.name).toBe("submit_palpite");
    expect(palpitesCartridge.tool.inputSchema).toBe(
      SUBMIT_PALPITE_TOOL.input_schema,
    );
  });
  it("a versão é palpites_v2", () => {
    expect(PALPITES_VERSION).toBe("palpites_v2");
    expect(palpitesCartridge.version).toBe("palpites_v2");
  });
  it("o tool NÃO declara campos de valor (firewall estrutural)", () => {
    const props = SUBMIT_PALPITE_TOOL.input_schema.properties as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual([
      "citedMarkets",
      "confidence",
      "narrative",
      "probableScore",
      "verdict",
    ]);
    expect(SUBMIT_PALPITE_TOOL.input_schema.additionalProperties).toBe(false);
  });
});

// ─── prompt: proíbe value-language, exige a manchete + cobre all-pass ──────────

describe("SYSTEM_PROMPT", () => {
  it("proíbe explicitamente odd/edge/stake/Yield e exige a chamada do tool", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    expect(p).toContain("odd");
    expect(p).toContain("edge");
    expect(p).toContain("stake");
    expect(p).toContain("yield");
    expect(p).toContain("submit_palpite");
    // Veredito + placar provável.
    expect(p).toContain("placar provável");
  });

  it("instrui o caso ALL-PASS (palpite mesmo sem valor em nenhum mercado)", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    expect(p).toContain("pass");
    expect(p).toMatch(/mesmo que nenhum|mesmo sem|nunca recuse/);
  });
});

// ─── buildPredictionInput + buildUserMessage ──────────────────────────────────

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

const standings: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "CR Flamengo",
          played: 10,
          won: 7,
          draw: 2,
          lost: 1,
          goalsFor: 20,
          goalsAgainst: 8,
          points: 23,
        },
        {
          position: 5,
          team: "Fluminense FC",
          played: 10,
          won: 4,
          draw: 3,
          lost: 3,
          goalsFor: 14,
          goalsAgainst: 12,
          points: 15,
        },
      ],
    },
  ],
};

function analysis(over: Partial<MarketAnalysisSummary> = {}): MarketAnalysisSummary {
  return {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "home",
    recommendedLabel: "Casa",
    isPass: false,
    modelProbPct: 58,
    edgePct: 9,
    confidencePct: 60,
    oddAtRecommendation: 1.85,
    rationale: "Mandante muito superior.",
    predictionId: "pred-1",
    selections: [
      { key: "home", modelProbPct: 58 },
      { key: "draw", modelProbPct: 24 },
      { key: "away", modelProbPct: 18 },
    ],
    ...over,
  };
}

function baseArgs(analyses: MarketAnalysisSummary[] = [analysis()]): BuildPalpitesInputArgs {
  return {
    match: {
      league: "brasileirao_a" as never,
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
    },
    fixture: { ...fixture("CR Flamengo", "Fluminense FC", 0, 0), venue: "Maracanã" },
    homeForm: [
      fixture("CR Flamengo", "X", 3, 1),
      fixture("Y", "CR Flamengo", 0, 2),
    ],
    awayForm: [fixture("Fluminense FC", "Z", 1, 1)],
    h2h: [fixture("CR Flamengo", "Fluminense FC", 2, 1)],
    standings,
    analyses,
  };
}

describe("buildPredictionInput", () => {
  it("resume forma, acha standings e carrega as análises", () => {
    const input = buildPredictionInput(baseArgs());
    expect(input.match.homeTeam).toBe("CR Flamengo");
    expect(input.match.venue).toBe("Maracanã");
    // Flamengo: marcou 3 (casa) + 2 (fora) = 5/2 = 2.5; sofreu 1 + 0 = 0.5.
    expect(input.homeForm.avgGoalsFor).toBeCloseTo(2.5);
    expect(input.homeForm.avgGoalsAgainst).toBeCloseTo(0.5);
    expect(input.homeForm.results).toEqual(["W", "W"]);
    expect(input.homeStanding?.position).toBe(1);
    expect(input.awayStanding?.position).toBe(5);
    expect(input.analyses).toHaveLength(1);
    expect(input.analyses[0].marketLabel).toBe("Resultado (1X2)");
  });

  it("aceita analyses vazio (caso degenerado)", () => {
    const input = buildPredictionInput(baseArgs([]));
    expect(input.analyses).toEqual([]);
  });
});

describe("buildUserMessage", () => {
  it("inclui a seção de análises com edge/odd (DADO) e o racional", () => {
    const input = buildPredictionInput(baseArgs());
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("Análises por mercado");
    expect(msg).toContain("Resultado (1X2)");
    expect(msg).toContain("Casa");
    expect(msg).toContain("edge");
    expect(msg).toContain("Mandante muito superior.");
  });

  it("renderiza o pass como 'sem valor recomendado'", () => {
    const input = buildPredictionInput(
      baseArgs([analysis({ isPass: true, recommendation: "pass", recommendedLabel: null, edgePct: null, oddAtRecommendation: null, modelProbPct: null })]),
    );
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("sem valor recomendado (pass)");
  });

  it("instrui a síntese mesmo sem análises (all-empty)", () => {
    const input = buildPredictionInput(baseArgs([]));
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("nenhuma análise disponível");
    expect(msg).toContain("Sua tarefa");
  });
});
