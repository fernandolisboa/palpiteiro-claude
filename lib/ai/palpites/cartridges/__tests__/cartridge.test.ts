import { describe, expect, it } from "vitest";

import type {
  DbPalpite,
  PalpiteSetWithLines,
} from "@/lib/db/queries/palpites";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

import {
  PALPITES_VERSION,
  PalpitesOutputSchema,
  SUBMIT_PALPITES_TOOL,
  buildPredictionInput,
  buildUserMessage,
  palpitesCartridge,
  type BuildPalpitesInputArgs,
} from "../cartridge";
import { deriveSettleable } from "../../settleable";

// ─── PalpitesOutputSchema ─────────────────────────────────────────────────────

const validMix = {
  palpites: [
    { type: "exact_score", text: "2 a 1 pro mandante", params: { home: 2, away: 1 } },
    { type: "red_card", text: "Esse clássico pega fogo!" },
    { type: "corners", text: "Vai ter escanteio pra todo lado." },
  ],
};

describe("PalpitesOutputSchema", () => {
  it("aceita um MIX válido (1 exact_score + linhas fun, 2–4 itens)", () => {
    const parsed = PalpitesOutputSchema.safeParse(validMix);
    expect(parsed.success).toBe(true);
  });

  it("aceita o mínimo (1 exact_score + 1 fun = 2 itens)", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "1 a 0", params: { home: 1, away: 0 } },
        { type: "corners", text: "muito escanteio" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita params FALTANDO no exact_score", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "sem params" },
        { type: "red_card", text: "vermelho" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita home negativo / não-inteiro / >20", () => {
    for (const params of [
      { home: -1, away: 0 },
      { home: 1.5, away: 0 },
      { home: 21, away: 0 },
    ]) {
      const parsed = PalpitesOutputSchema.safeParse({
        palpites: [
          { type: "exact_score", text: "x", params },
          { type: "red_card", text: "y" },
        ],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejeita array com <2 ou >4 itens", () => {
    const tooFew = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "x", params: { home: 1, away: 1 } },
      ],
    });
    expect(tooFew.success).toBe(false);

    const tooMany = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "x", params: { home: 1, away: 1 } },
        { type: "red_card", text: "a" },
        { type: "corners", text: "b" },
        { type: "red_card", text: "c" },
        { type: "corners", text: "d" },
      ],
    });
    expect(tooMany.success).toBe(false);
  });

  it("rejeita text vazio", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "", params: { home: 1, away: 1 } },
        { type: "red_card", text: "ok" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita params numa linha FUN (discriminated union)", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: "x", params: { home: 1, away: 1 } },
        { type: "red_card", text: "y", params: { home: 0, away: 0 } },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita um campo settleable parasita no output (.strict)", () => {
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: validMix.palpites,
      settleable: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("trunca text >280 (prose-tolerante, não rejeita)", () => {
    const long = "a".repeat(400);
    const parsed = PalpitesOutputSchema.safeParse({
      palpites: [
        { type: "exact_score", text: long, params: { home: 1, away: 1 } },
        { type: "red_card", text: "ok" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.palpites[0].text.length).toBe(280);
      expect(parsed.data.palpites[0].text.endsWith("…")).toBe(true);
    }
  });
});

// ─── deriveSettleable ─────────────────────────────────────────────────────────

describe("deriveSettleable", () => {
  it("exact_score → true; red_card/corners → false", () => {
    expect(deriveSettleable("exact_score")).toBe(true);
    expect(deriveSettleable("red_card")).toBe(false);
    expect(deriveSettleable("corners")).toBe(false);
  });
});

// ─── tool shape ───────────────────────────────────────────────────────────────

describe("SUBMIT_PALPITES_TOOL", () => {
  it("o cartucho expõe o ToolDef neutro com o mesmo nome", () => {
    expect(palpitesCartridge.toolName).toBe("submit_palpites");
    expect(palpitesCartridge.tool.name).toBe("submit_palpites");
    expect(palpitesCartridge.tool.inputSchema).toBe(
      SUBMIT_PALPITES_TOOL.input_schema,
    );
  });
  it("a versão é palpites_v1", () => {
    expect(PALPITES_VERSION).toBe("palpites_v1");
    expect(palpitesCartridge.version).toBe("palpites_v1");
  });
});

// ─── prompt: proibição de value-language ──────────────────────────────────────

describe("SYSTEM_PROMPT", () => {
  it("proíbe explicitamente odd/edge/stake/Yield e exige o mix", () => {
    const p = palpitesCartridge.systemPrompt.toLowerCase();
    expect(p).toContain("odd");
    expect(p).toContain("edge");
    expect(p).toContain("stake");
    expect(p).toContain("yield");
    expect(p).toContain("exatamente um");
    expect(p).toContain("submit_palpites");
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

function baseArgs(previousSets: PalpiteSetWithLines[] = []): BuildPalpitesInputArgs {
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
    previousSets,
  };
}

function makeLine(over: Partial<DbPalpite>): DbPalpite {
  return {
    id: over.id ?? "p-1",
    palpiteSetId: "s-1",
    type: over.type ?? "exact_score",
    text: over.text ?? "x",
    params: over.params ?? null,
    settleable: over.settleable ?? false,
    createdAt: new Date(),
  };
}

function makeSet(lines: DbPalpite[]): PalpiteSetWithLines {
  return {
    palpiteSet: {
      id: "s-1",
      matchId: "m-1",
      userId: "u-1",
      aiCallId: null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v1",
      createdAt: new Date(),
    },
    aiCall: null,
    palpites: lines.map((l) => ({ ...l, outcome: null })),
  };
}

describe("buildPredictionInput", () => {
  it("resume forma (médias na perspectiva do time) e acha standings", () => {
    const input = buildPredictionInput(baseArgs());
    expect(input.match.homeTeam).toBe("CR Flamengo");
    expect(input.match.venue).toBe("Maracanã");
    // Flamengo: marcou 3 (casa) + 2 (fora) = 5/2 = 2.5; sofreu 1 + 0 = 0.5.
    expect(input.homeForm.avgGoalsFor).toBeCloseTo(2.5);
    expect(input.homeForm.avgGoalsAgainst).toBeCloseTo(0.5);
    expect(input.homeForm.results).toEqual(["W", "W"]);
    expect(input.homeStanding?.position).toBe(1);
    expect(input.awayStanding?.position).toBe(5);
  });

  it("achata previousSets em excludedScores E excludedFunIdeas", () => {
    const prev = makeSet([
      makeLine({
        id: "a",
        type: "exact_score",
        params: { home: 2, away: 1 },
        settleable: true,
      }),
      makeLine({ id: "b", type: "red_card", text: "vai ter vermelho" }),
      makeLine({ id: "c", type: "corners", text: "muito escanteio" }),
    ]);
    const input = buildPredictionInput(baseArgs([prev]));
    expect(input.excludedScores).toEqual([{ home: 2, away: 1 }]);
    expect(input.excludedFunIdeas).toEqual([
      { type: "red_card", text: "vai ter vermelho" },
      { type: "corners", text: "muito escanteio" },
    ]);
  });

  it("listas de exclusão vazias na 1ª geração (previousSets [])", () => {
    const input = buildPredictionInput(baseArgs([]));
    expect(input.excludedScores).toEqual([]);
    expect(input.excludedFunIdeas).toEqual([]);
  });
});

describe("buildUserMessage", () => {
  it("omite a seção 'Não repita' quando não há exclusões", () => {
    const input = buildPredictionInput(baseArgs([]));
    const msg = buildUserMessage(input, { daysToKickoff: 2 });
    expect(msg).not.toContain("Não repita");
  });

  it("inclui placares E ideias fun na seção 'Não repita' quando há exclusões", () => {
    const prev = makeSet([
      makeLine({
        id: "a",
        type: "exact_score",
        params: { home: 3, away: 0 },
        settleable: true,
      }),
      makeLine({ id: "b", type: "red_card", text: "vermelho saindo" }),
    ]);
    const input = buildPredictionInput(baseArgs([prev]));
    const msg = buildUserMessage(input, { daysToKickoff: 1 });
    expect(msg).toContain("Não repita");
    expect(msg).toContain("Placares já sugeridos");
    expect(msg).toContain("3-0");
    expect(msg).toContain("Ideias fun já usadas");
    expect(msg).toContain("vermelho saindo");
  });

  it("renderiza só a sub-seção de placares quando não há ideias fun prévias", () => {
    const prev = makeSet([
      makeLine({
        id: "a",
        type: "exact_score",
        params: { home: 1, away: 1 },
        settleable: true,
      }),
    ]);
    const input = buildPredictionInput(baseArgs([prev]));
    const msg = buildUserMessage(input, { daysToKickoff: 1 });
    expect(msg).toContain("Placares já sugeridos");
    expect(msg).not.toContain("Ideias fun já usadas");
  });
});
