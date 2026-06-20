import { describe, expect, it } from "vitest";

import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

import {
  PALPITES_VERSION,
  PalpitesInputSchema,
  PalpitesOutputSchema,
  SUBMIT_PALPITE_TOOL,
  buildPredictionInput,
  buildUserMessage,
  palpitesCartridge,
  type BuildPalpitesInputArgs,
} from "../cartridge";
import { deriveSettleable } from "../../settleable";
import { containsValueLanguage } from "../../value-language-guard";

// ─── PalpitesOutputSchema (a MANCHETE, v3) ────────────────────────────────────

const validHeadline = {
  verdict: "Vai dar Flamengo",
  probableScore: { home: 2, away: 1 },
  firstHalfScore: { home: 1, away: 0 },
  firstToScore: "home" as const,
  confidence: "alta" as const,
  narrative: "O Fla vem voando em casa e o Flu sofre fora.",
  citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
};

describe("PalpitesOutputSchema (síntese v3)", () => {
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
      firstHalfScore: { home: 0, away: 0 },
      firstToScore: "none",
      confidence: "baixa",
      narrative: "Sem destaque claro nos mercados; aposto num empate apertado.",
      citedMarkets: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("#354: aceita firstHalfScore + firstToScore; rejeita firstToScore fora do enum / firstHalfScore inválido", () => {
    expect(
      PalpitesOutputSchema.safeParse({
        ...validHeadline,
        firstToScore: "both",
      }).success,
    ).toBe(false);
    expect(
      PalpitesOutputSchema.safeParse({
        ...validHeadline,
        firstHalfScore: { home: 21, away: 0 },
      }).success,
    ).toBe(false);
    // firstHalfScore/firstToScore faltando → rejeita (são required).
    const { firstHalfScore, firstToScore, ...withoutNew } = validHeadline;
    void firstHalfScore;
    void firstToScore;
    expect(PalpitesOutputSchema.safeParse(withoutNew).success).toBe(false);
  });

  it("#419: cardsTemperature é OPCIONAL — aceita OMITIDO + 'pegado'/'muito_pegado'", () => {
    // Omitido (jogo morno) → válido + undefined no parsed.
    const omitted = PalpitesOutputSchema.safeParse(validHeadline);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.cardsTemperature).toBeUndefined();
    for (const t of ["pegado", "muito_pegado"]) {
      expect(
        PalpitesOutputSchema.safeParse({ ...validHeadline, cardsTemperature: t })
          .success,
      ).toBe(true);
    }
  });

  it("#419: cardsTemperature REJEITA qualquer outro valor (sem precisão-fingida)", () => {
    for (const bad of ["morno", "4", 7, "pegadissimo", true]) {
      expect(
        PalpitesOutputSchema.safeParse({
          ...validHeadline,
          cardsTemperature: bad,
        }).success,
      ).toBe(false);
    }
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
  it("exact_score + goal-derived (#354) + cards (#394) → true; red_card/corners → false (Tier 3 de pé)", () => {
    expect(deriveSettleable("exact_score")).toBe(true);
    expect(deriveSettleable("margin")).toBe(true);
    expect(deriveSettleable("clean_sheet")).toBe(true);
    expect(deriveSettleable("first_half_score")).toBe(true);
    expect(deriveSettleable("first_to_score")).toBe(true);
    expect(deriveSettleable("red_card")).toBe(false);
    expect(deriveSettleable("corners")).toBe(false);
    // #394 — cards PROMOVIDO a settleable (web-grounded). deriveSettleable é league-BLIND:
    // a inércia das rows NOVAS vem da COBERTURA vazia (cards-coverage.ts), não daqui. As
    // rows #419 ANTIGAS seguem inertes pelo settleable=false PERSISTIDO (sem backfill).
    expect(deriveSettleable("cards")).toBe(true);
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
  it("a versão é palpites_v8 (#419 — cardsTemperature fun-only)", () => {
    expect(PALPITES_VERSION).toBe("palpites_v8");
    expect(palpitesCartridge.version).toBe("palpites_v8");
  });
  it("o tool NÃO declara campos de valor (firewall estrutural); declara firstHalfScore + firstToScore (#354) + cardsTemperature (#419)", () => {
    const props = SUBMIT_PALPITE_TOOL.input_schema.properties as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual([
      "cardsTemperature",
      "citedMarkets",
      "confidence",
      "firstHalfScore",
      "firstToScore",
      "narrative",
      "probableScore",
      "verdict",
    ]);
    expect(SUBMIT_PALPITE_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("#419 mirror: cardsTemperature tem enum ['pegado','muito_pegado'] e NÃO está em `required` (OPCIONAL — espelha o Zod .optional())", () => {
    const props = SUBMIT_PALPITE_TOOL.input_schema.properties as Record<
      string,
      { enum?: unknown }
    >;
    expect(props.cardsTemperature.enum).toEqual(["pegado", "muito_pegado"]);
    expect(SUBMIT_PALPITE_TOOL.input_schema.required).not.toContain(
      "cardsTemperature",
    );
    // os 7 campos obrigatórios de hoje seguem required (cardsTemperature é o único opcional).
    expect([...SUBMIT_PALPITE_TOOL.input_schema.required].sort()).toEqual([
      "citedMarkets",
      "confidence",
      "firstHalfScore",
      "firstToScore",
      "narrative",
      "probableScore",
      "verdict",
    ]);
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

  it("#376 / ADR 0031: é value-aware — autoriza o lado menos óbvio/azarão usando as análises", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    // O dogma do óbvio caiu: o prompt agora autoriza explicitamente o lado não-óbvio.
    expect(p).toMatch(/menos óbvio|azarão|não-óbvio/);
    // E o sinal das análises é insumo legítimo da previsão (não algo a ignorar).
    expect(p).toContain("análises");
  });

  it("#376: coherence-survival — a expansão value-aware NÃO derruba a exigência de placar provável coerente (badge settleable)", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    // A cláusula de coerência do badge liquidável (#354) segue no prompt.
    expect(p).toContain("placar provável");
    expect(p).toContain("coerente com o veredito");
  });

  it("#419: instrui cardsTemperature como campo OPCIONAL (omite em jogo morno) — temperatura, NÃO número", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    expect(p).toContain("cardstemperature");
    expect(p).toContain("pegado");
    expect(p).toContain("muito_pegado");
    // É opcional (pode omitir) e NUNCA um número de cartões.
    expect(p).toMatch(/omita|opcional/);
    expect(p).toContain("nunca um número de cartões");
  });

  it("#419 FIREWALL: proíbe mencionar cartões/árbitro/contagem em verdict ou narrative (a estimativa vai SÓ no campo estruturado)", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    // O único vetor de fabricação não-coberto pelo value-guard/validador de fidelidade
    // é fechado por uma cláusula de prompt: nada de cartão/árbitro na prosa.
    expect(p).toContain("cardstemperature");
    expect(p).toContain("verdict");
    expect(p).toContain("narrative");
    expect(p).toContain("árbitro");
    // Proibição explícita de cartões na prosa.
    expect(p).toMatch(/proibido mencionar cartões|nunca mencione cartões/);
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

// ─── PalpitesInputSchema: news (#377 / ADR 0032) ──────────────────────────────

describe("PalpitesInputSchema — news (#377)", () => {
  const baseInput = {
    match: {
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: "2026-05-15T19:00:00.000Z",
    },
    analyses: [],
    homeForm: {
      team: "CR Flamengo",
      gamesConsidered: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      results: [],
    },
    awayForm: {
      team: "Fluminense FC",
      gamesConsidered: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      results: [],
    },
    h2h: [],
  };

  it("aceita news com {title,url}", () => {
    const parsed = PalpitesInputSchema.safeParse({
      ...baseInput,
      news: [{ title: "Desfalque confirmado", url: "https://ge.globo.com/a" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("default [] quando news é omitido", () => {
    const parsed = PalpitesInputSchema.safeParse(baseInput);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.news).toEqual([]);
  });

  it("rejeita >10 notícias", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      title: `T${i}`,
      url: `https://ge.globo.com/${i}`,
    }));
    const parsed = PalpitesInputSchema.safeParse({ ...baseInput, news: eleven });
    expect(parsed.success).toBe(false);
  });

  it("rejeita title ou url vazios (nunca inventa fonte)", () => {
    expect(
      PalpitesInputSchema.safeParse({
        ...baseInput,
        news: [{ title: "", url: "https://ge.globo.com/a" }],
      }).success,
    ).toBe(false);
    expect(
      PalpitesInputSchema.safeParse({
        ...baseInput,
        news: [{ title: "ok", url: "" }],
      }).success,
    ).toBe(false);
  });
});

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

  it("#419: a '# Sua tarefa' menciona cardsTemperature como OPCIONAL e reforça NÃO citar cartões/árbitro na prosa", () => {
    const input = buildPredictionInput(baseArgs());
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("cardsTemperature");
    expect(msg.toLowerCase()).toContain("pegado");
    expect(msg.toLowerCase()).toMatch(/nunca cite cartões|omita/);
  });

  it("v4: pré-conta a forma (V/E/D) + renderiza a sequência rotulada do mais recente ao mais antigo", () => {
    // Forma do mandante: 3 vitórias / 1 empate / 1 derrota, na ordem (mais recente →
    // mais antigo) D W W W L → display "E V V V D". Cuidado com a colisão de D:
    // D=empate→"E", L=derrota→"D".
    const args = baseArgs();
    args.homeForm = [
      fixture("X", "CR Flamengo", 1, 1), // empate (E) — mais recente
      fixture("CR Flamengo", "X", 2, 0), // vitória (V)
      fixture("CR Flamengo", "Y", 3, 1), // vitória (V)
      fixture("Z", "CR Flamengo", 0, 1), // vitória (V)
      fixture("CR Flamengo", "W", 0, 2), // derrota (D) — mais antigo
    ];
    const input = buildPredictionInput(args);
    // summarizeForm preserva a ordem das fixtures → results = D W W W L (W/D/L interno).
    expect(input.homeForm.results).toEqual(["D", "W", "W", "W", "L"]);

    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain(
      "- Forma recente (últimos 5): 3V 1E 1D · do mais recente ao mais antigo: E V V V D",
    );
    // NÃO renderiza mais a string crua de letras internas (W/D/L colados).
    expect(msg).not.toContain("DWWWL");
  });

  it("v4: forma vazia preserva a affordance (sem dados)", () => {
    const args = baseArgs();
    args.homeForm = [];
    const input = buildPredictionInput(args);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("- Forma recente: (sem dados)");
  });

  it("#377: renderiza a seção de notícias com título+URL + a instrução 'cite o fato, nunca o valor'", () => {
    const args = baseArgs();
    args.news = [
      { title: "Flamengo perde titular", url: "https://ge.globo.com/x" },
    ];
    const input = buildPredictionInput(args);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("Notícias recentes (fontes reais)");
    expect(msg).toContain("Flamengo perde titular (https://ge.globo.com/x)");
    expect(msg).toContain("cite o fato, NUNCA a linguagem de valor da fonte");
  });

  it("#377: sem notícias renderiza '(nenhuma notícia encontrada)'", () => {
    const input = buildPredictionInput(baseArgs());
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("Notícias recentes (fontes reais)");
    expect(msg).toContain("(nenhuma notícia encontrada)");
  });
});

// ─── #379: fatos estruturados (H2H + últimos placares PRÉ-CONTADOS) ────────────

describe("#379 — buildPredictionInput deriva os fatos pré-contados", () => {
  it("deriva h2hSummary na perspectiva as-played (Flamengo 2-1 Flu, Flu 0-1 Flamengo → 1V mandante, 1V visitante, 0E)", () => {
    const args = baseArgs();
    // Dois confrontos com mandante/visitante INVERTIDOS entre eles (as-played):
    // (1) Flamengo 2-1 Fluminense → vitória do mandante DAQUELE jogo (home_win).
    // (2) Fluminense 0-1 Flamengo → vitória do visitante DAQUELE jogo (away_win).
    args.h2h = [
      fixture("CR Flamengo", "Fluminense FC", 2, 1),
      fixture("Fluminense FC", "CR Flamengo", 0, 1),
    ];
    const input = buildPredictionInput(args);
    const s = input.h2hSummary!;
    expect(s.gamesConsidered).toBe(2);
    expect(s.homeWins).toBe(1);
    expect(s.awayWins).toBe(1);
    expect(s.draws).toBe(0);
    expect(s.sequence).toEqual(["home_win", "away_win"]);
    // Rótulos do JOGO vindouro (só pra rotular o tally no prompt).
    expect(s.homeTeam).toBe("CR Flamengo");
    expect(s.awayTeam).toBe("Fluminense FC");
  });

  it("h2hSummary pula confrontos sem placar (score null) — gamesConsidered conta só os contados", () => {
    const args = baseArgs();
    const nullScore = fixture("CR Flamengo", "Fluminense FC", 0, 0);
    nullScore.score = { home: null, away: null };
    args.h2h = [
      fixture("CR Flamengo", "Fluminense FC", 3, 0), // home_win
      nullScore, // pulado
    ];
    const input = buildPredictionInput(args);
    expect(input.h2hSummary!.gamesConsidered).toBe(1);
    expect(input.h2hSummary!.homeWins).toBe(1);
    expect(input.h2hSummary!.sequence).toEqual(["home_win"]);
  });

  it("deriva homeRecentScores/awayRecentScores (V/E/D + gols pró/contra totais, perspectiva do time)", () => {
    // homeForm do baseArgs: Flamengo 3-1 X (V, 3 pró/1 contra) + Y 0-2 Flamengo
    // (Flamengo fora: 2 pró/0 contra, V). Total: 2V 0E 0D, 5 gols pró / 1 contra.
    const input = buildPredictionInput(baseArgs());
    const home = input.homeRecentScores!;
    expect(home.gamesConsidered).toBe(2);
    expect(home.wins).toBe(2);
    expect(home.draws).toBe(0);
    expect(home.losses).toBe(0);
    expect(home.goalsFor).toBe(5);
    expect(home.goalsAgainst).toBe(1);
    // awayForm: Fluminense 1-1 Z → 1 jogo, 1 empate, 1 pró / 1 contra.
    const away = input.awayRecentScores!;
    expect(away.gamesConsidered).toBe(1);
    expect(away.draws).toBe(1);
    expect(away.goalsFor).toBe(1);
    expect(away.goalsAgainst).toBe(1);
  });
});

describe("#379 — PalpitesInputSchema aceita os 3 campos novos opcionais", () => {
  const baseInput = {
    match: {
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: "2026-05-15T19:00:00.000Z",
    },
    analyses: [],
    homeForm: {
      team: "CR Flamengo",
      gamesConsidered: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      results: [],
    },
    awayForm: {
      team: "Fluminense FC",
      gamesConsidered: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      results: [],
    },
    h2h: [],
  };

  it("parseia SEM os 3 campos (back-comply — baseInput montado à mão dos testes de news)", () => {
    const parsed = PalpitesInputSchema.safeParse(baseInput);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.h2hSummary).toBeUndefined();
      expect(parsed.data.homeRecentScores).toBeUndefined();
      expect(parsed.data.awayRecentScores).toBeUndefined();
    }
  });

  it("aceita os 3 campos quando presentes", () => {
    const parsed = PalpitesInputSchema.safeParse({
      ...baseInput,
      h2hSummary: {
        homeTeam: "CR Flamengo",
        awayTeam: "Fluminense FC",
        homeWins: 1,
        awayWins: 0,
        draws: 0,
        gamesConsidered: 1,
        sequence: ["home_win"],
      },
      homeRecentScores: {
        team: "CR Flamengo",
        gamesConsidered: 2,
        wins: 2,
        draws: 0,
        losses: 0,
        goalsFor: 5,
        goalsAgainst: 1,
      },
      awayRecentScores: {
        team: "Fluminense FC",
        gamesConsidered: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        goalsFor: 1,
        goalsAgainst: 1,
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("#379 — buildUserMessage renderiza os fatos pré-contados (tally, não dump)", () => {
  it("H2H: lidera com o tally rotulado (mandante/visitante do jogo) + sequência, NÃO o dump por-fixture", () => {
    const args = baseArgs();
    args.h2h = [
      fixture("CR Flamengo", "Fluminense FC", 2, 1), // home_win
      fixture("Fluminense FC", "CR Flamengo", 0, 1), // away_win
    ];
    const input = buildPredictionInput(args);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("Em 2 confronto(s):");
    expect(msg).toContain("vitória(s) do mandante do jogo");
    expect(msg).toContain("vitória(s) do visitante do jogo");
    expect(msg).toContain("Do mais recente ao mais antigo:");
    // Inteiros + rótulos só — NUNCA % / aproveitamento (espírito do firewall). Recorta
    // só o bloco do H2H (do header até o próximo '#') pra não pegar o % das Análises.
    const start = msg.indexOf("# Confrontos diretos");
    const end = msg.indexOf("\n#", start + 1);
    const h2hBlock = msg.slice(start, end === -1 ? undefined : end);
    expect(h2hBlock).not.toContain("%");
    expect(h2hBlock.toLowerCase()).not.toContain("aproveitamento");
  });

  it("H2H vazio → '(sem histórico fornecido)'", () => {
    const args = baseArgs();
    args.h2h = [];
    const input = buildPredictionInput(args);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("- (sem histórico fornecido)");
  });

  it("últimos placares: bullet pré-contada (placares contados + gols marcados/sofridos)", () => {
    const input = buildPredictionInput(baseArgs());
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).toContain("placares contados");
    expect(msg).toContain("gols marcados");
    expect(msg).toContain("sofridos no total");
    // Mandante: 2V 0E 0D, 5 gols marcados / 1 sofrido.
    expect(msg).toContain(
      "- Últimos 2 jogos (placares contados): 2V 0E 0D · 5 gols marcados / 1 sofridos no total",
    );
  });

  it("pin de branch: h2h.length>0 com TODOS os placares null → gamesConsidered=0 → fallback raw (quirk pré-existente do ?? 0)", () => {
    const args = baseArgs();
    const a = fixture("CR Flamengo", "Fluminense FC", 0, 0);
    a.score = { home: null, away: null };
    const b = fixture("Fluminense FC", "CR Flamengo", 0, 0);
    b.score = { home: null, away: null };
    args.h2h = [a, b];
    const input = buildPredictionInput(args);
    // summarizeH2H pula ambos → gamesConsidered=0 → cai no fallback raw, que renderiza
    // 0-0 (quirk pré-existente do `?? 0` no map de h2h — não introduzido por #379).
    expect(input.h2hSummary!.gamesConsidered).toBe(0);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).not.toContain("Em 0 confronto(s):");
    // Dump raw: linha datada com o placar 0-0 do fallback.
    expect(msg).toContain("CR Flamengo 0-0 Fluminense FC");
  });

  it("FIREWALL-NO-INPUT: um time com substring de valor ('Odd FC') renderiza como FATO e NÃO derruba a síntese nem vaza valor", () => {
    // 'Odd FC' é um clube REAL — e casa o termo value-ish do guard (\bodds?\b). Como é
    // INPUT (nome de time num fato estruturado), NUNCA pode tropeçar no firewall nem
    // vazar pra manchete. Pina a invariante: o guard só lê o OUTPUT.
    expect(containsValueLanguage("Odd FC")).toBe(true); // o termo É value-ish…
    const args = baseArgs();
    args.match.awayTeam = "Odd FC";
    args.awayForm = [fixture("Odd FC", "Z", 1, 0)];
    args.h2h = [fixture("CR Flamengo", "Odd FC", 2, 1)];
    const input = buildPredictionInput(args);
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    // …e renderiza como FATO nas novas seções (tally do H2H + nome no cabeçalho).
    expect(msg).toContain("Odd FC");
    expect(msg).toContain("vitória(s) do visitante do jogo (Odd FC)");
    // A síntese (um output LIMPO) segue passando o guard — o nome do time é INPUT, o
    // guard nunca o lê. (validHeadline não contém 'Odd' → manchete limpa.)
    expect(containsValueLanguage(validHeadline.verdict)).toBe(false);
    expect(containsValueLanguage(validHeadline.narrative)).toBe(false);
  });
});
