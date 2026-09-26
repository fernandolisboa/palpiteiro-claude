// @vitest-environment node
//
// Harness de calibração (Report 03 rec. 3, ADR 0037) contra Postgres REAL via pglite.
// Cobre: monta os pares (modelPOver, marketPOver no-vig, overHappened) das predições
// over/under liquidadas; exclui as sem P(over) do modelo e as sem outcome; overHappened
// = totalGoals > line; agrupa por promptVersion. E (#453) os pares dos outros mercados
// de partição: 1X2 e dupla chance um-contra-o-resto, btts no lado "sim". Roda em `node`.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    },
  ),
}));

import {
  getMarketCalibrationRows,
  getOverUnderCalibrationRows,
} from "@/lib/db/queries/calibration";

const ids: {
  userId: string;
  aiCallId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
  // #453: marketId + seleções (key → id) dos outros mercados calibrados.
  other: Record<string, { marketId: string; sel: Record<string, string> }>;
} = {} as never;

let seq = 0;

async function seedOU(args: {
  promptVersion: string;
  line: number;
  totalGoals: number;
  overModelPct: number | null;
  overOdd: string;
  underOdd: string;
  withOutcome?: boolean;
  result?: "won" | "lost" | "void";
  recommendation?: "over" | "pass";
  modelVersion?: string;
}): Promise<void> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-cal-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });

  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: m.id,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: ids.ouMarketId,
      selectionId: args.recommendation === "pass" ? null : ids.ouOver,
      recommendation: args.recommendation ?? "over",
      confidencePct: "55.00",
      rationale: "r",
      keyFactors: ["f"],
      modelVersion: args.modelVersion ?? "claude-sonnet-4-5-20250929",
      promptVersion: args.promptVersion,
      marketParams: { line: args.line },
    })
    .returning({ id: schema.predictions.id });

  if (args.withOutcome !== false) {
    await realDb.insert(schema.predictionOutcomes).values({
      predictionId: p.id,
      resultData: {
        homeScore: null,
        awayScore: null,
        totalGoals: args.totalGoals,
      },
      result: args.result ?? "won",
      profitUnits: "0",
    });
  }

  await realDb.insert(schema.predictionSelectionOdds).values([
    {
      predictionId: p.id,
      selectionId: ids.ouOver,
      odd: args.overOdd,
      modelProbPct:
        args.overModelPct === null ? null : args.overModelPct.toFixed(2),
    },
    {
      predictionId: p.id,
      selectionId: ids.ouUnder,
      odd: args.underOdd,
      modelProbPct: null,
    },
  ]);
}

// Predição liquidada de um mercado não-O/U, com odd + modelProbPct por seleção.
async function seedMarket(args: {
  market: "match_result" | "btts" | "double_chance";
  homeScore: number | null;
  awayScore: number | null;
  sels: Record<string, { odd: string; modelPct: number | null }>;
  recommendation?: string;
  promptVersion?: string;
}): Promise<void> {
  const mk = ids.other[args.market];
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-cal-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  const rec = args.recommendation ?? Object.keys(args.sels)[0];
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: m.id,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: mk.marketId,
      selectionId: rec === "pass" ? null : mk.sel[rec],
      recommendation: rec,
      confidencePct: "55.00",
      rationale: "r",
      keyFactors: ["f"],
      modelVersion: "claude-sonnet-4-5-20250929",
      promptVersion: args.promptVersion ?? `${args.market}_v1`,
      marketParams: null,
    })
    .returning({ id: schema.predictions.id });
  await realDb.insert(schema.predictionOutcomes).values({
    predictionId: p.id,
    resultData: {
      homeScore: args.homeScore,
      awayScore: args.awayScore,
      totalGoals: (args.homeScore ?? 0) + (args.awayScore ?? 0),
    },
    result: rec === "pass" ? "void" : "won",
    profitUnits: "0",
  });
  await realDb.insert(schema.predictionSelectionOdds).values(
    Object.entries(args.sels).map(([key, v]) => ({
      predictionId: p.id,
      selectionId: mk.sel[key],
      odd: v.odd,
      modelProbPct: v.modelPct === null ? null : v.modelPct.toFixed(2),
    })),
  );
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [ou] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const sels = await base
    .select({
      id: schema.marketSelections.id,
      key: schema.marketSelections.key,
    })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ou.id));
  ids.ouOver = sels.find((s) => s.key === "over")!.id;
  ids.ouUnder = sels.find((s) => s.key === "under")!.id;

  ids.other = {};
  for (const key of ["match_result", "btts", "double_chance"]) {
    const [m] = await base
      .select({ id: schema.markets.id })
      .from(schema.markets)
      .where(eq(schema.markets.key, key));
    const ms = await base
      .select({
        id: schema.marketSelections.id,
        key: schema.marketSelections.key,
      })
      .from(schema.marketSelections)
      .where(eq(schema.marketSelections.marketId, m.id));
    ids.other[key] = {
      marketId: m.id,
      sel: Object.fromEntries(ms.map((x) => [x.key, x.id])),
    };
  }

  const [u] = await base
    .insert(schema.users)
    .values({ email: "cal@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  // ai_calls.match_id é NOT NULL — um match compartilhado só pro FK do aiCall.
  const [am] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-cal-aicall",
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  const [ai] = await base
    .insert(schema.aiCalls)
    .values({
      userId: u.id,
      matchId: am.id,
      model: "claude-sonnet-4-5-20250929",
      promptVersion: "over_under_v3.2",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.000001",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ai.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictionOutcomes);
  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
});

describe("getOverUnderCalibrationRows", () => {
  it("sem predições liquidadas → vazio", async () => {
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("monta o par: modelPOver, marketPOver de-vigado, overHappened, versão", async () => {
    await seedOU({
      promptVersion: "over_under_v3.2",
      line: 2.5,
      totalGoals: 3, // > 2.5 → over aconteceu
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].promptVersion).toBe("over_under_v3.2");
    expect(rows[0].modelPOver).toBeCloseTo(0.6, 9);
    expect(rows[0].overHappened).toBe(1);
    expect(rows[0].isBet).toBe(true);
    // de-vig(1.90, 1.95): (1/1.9)/((1/1.9)+(1/1.95)) ≈ 0.5065
    expect(rows[0].marketPOver).toBeCloseTo(0.5065, 3);
    // Sem tag de motor no modelVersion → llm (ADR 0041 §5, #513).
    expect(rows[0].engine).toBe("llm");
    expect(rows[0].engineConfig).toBeNull();
  });

  it("lê o motor code_jev + tags do modelVersion", async () => {
    await seedOU({
      promptVersion: "narrator_v1",
      modelVersion:
        "claude-sonnet-4-5-20250929;engine=code_jev;lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 58,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].engine).toBe("code_jev");
    expect(rows[0].engineConfig).toBe(
      "lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1",
    );
    expect(rows[0].promptVersion).toBe("narrator_v1");
  });

  it("overHappened = totalGoals > line (total 2, line 2.5 → 0)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 2,
      overModelPct: 40,
      overOdd: "2.100",
      underOdd: "1.750",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows[0].overHappened).toBe(0);
  });

  it("exclui predição sem P(over) do modelo (modelProbPct null)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: null,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("inclui pass (void/0 com placar real) como isBet=false", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 1,
      overModelPct: 45,
      overOdd: "1.900",
      underOdd: "1.950",
      result: "void",
      recommendation: "pass",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].isBet).toBe(false);
    expect(rows[0].overHappened).toBe(0);
    expect(rows[0].modelPOver).toBeCloseTo(0.45, 9);
  });

  it("exclui outcome 'void' de aposta (anulado pelo admin — rótulo sem sentido)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
      result: "void",
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("exclui predição sem outcome (não liquidada)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
      withOutcome: false,
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });
});

describe("getOverUnderCalibrationRows · linha inteira", () => {
  it("exclui push (total = linha inteira): o evento não é binário", async () => {
    await seedOU({
      promptVersion: "v",
      line: 3,
      totalGoals: 3,
      overModelPct: 50,
      overOdd: "2.000",
      underOdd: "1.850",
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });
});

describe("getMarketCalibrationRows (#453)", () => {
  it("1X2: um par por seleção (away/draw/home), y do placar, mercado de-vigado", async () => {
    await seedMarket({
      market: "match_result",
      homeScore: 2,
      awayScore: 1,
      sels: {
        home: { odd: "2.000", modelPct: 50 },
        draw: { odd: "3.400", modelPct: 27 },
        away: { odd: "3.800", modelPct: 23 },
      },
    });
    const rows = await getMarketCalibrationRows();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.marketKey).toBe("match_result");
    expect(r.promptVersion).toBe("match_result_v1");
    expect(r.isBet).toBe(true);
    // Ordem estável por key: away, draw, home.
    expect(r.model.map((x) => x.y)).toEqual([0, 0, 1]);
    expect(r.model.map((x) => x.p)).toEqual([0.23, 0.27, 0.5]);
    expect(r.market.map((x) => x.y)).toEqual([0, 0, 1]);
    const raw = [1 / 3.8, 1 / 3.4, 1 / 2];
    const sum = raw.reduce((a, b) => a + b, 0);
    r.market.forEach((x, i) => expect(x.p).toBeCloseTo(raw[i] / sum, 9));
    // Não vaza pro recorte over/under.
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("btts: um par só, no lado 'sim' (modelProb do 'não' pode faltar)", async () => {
    await seedMarket({
      market: "btts",
      homeScore: 1,
      awayScore: 0,
      sels: {
        yes: { odd: "1.800", modelPct: 58 },
        no: { odd: "2.000", modelPct: null },
      },
      recommendation: "pass",
    });
    const [r] = await getMarketCalibrationRows();
    expect(r.marketKey).toBe("btts");
    expect(r.isBet).toBe(false);
    expect(r.model).toEqual([{ p: 0.58, y: 0 }]);
    // de-vig(1.80, 2.00): (1/1.8)/((1/1.8)+(1/2)) ≈ 0.5263
    expect(r.market[0].p).toBeCloseTo(0.5263, 3);
    expect(r.market[0].y).toBe(0);
  });

  it("dupla chance: Σ=2 (impliedSumTarget), 2 das 3 seleções acontecem", async () => {
    await seedMarket({
      market: "double_chance",
      homeScore: 0,
      awayScore: 0,
      sels: {
        home_or_draw: { odd: "1.300", modelPct: 72 },
        away_or_draw: { odd: "1.600", modelPct: 58 },
        home_or_away: { odd: "1.350", modelPct: 70 },
      },
    });
    const [r] = await getMarketCalibrationRows();
    expect(r.marketKey).toBe("double_chance");
    // Ordem por key: away_or_draw, home_or_away, home_or_draw. Empate → 1X e X2.
    expect(r.model.map((x) => x.y)).toEqual([1, 0, 1]);
    const marketSum = r.market.reduce((a, x) => a + x.p, 0);
    expect(marketSum).toBeCloseTo(2, 9);
  });

  it("N-ário exige modelProb de TODAS as seleções", async () => {
    await seedMarket({
      market: "match_result",
      homeScore: 0,
      awayScore: 0,
      sels: {
        home: { odd: "2.000", modelPct: 50 },
        draw: { odd: "3.400", modelPct: null },
        away: { odd: "3.800", modelPct: 23 },
      },
    });
    expect(await getMarketCalibrationRows()).toEqual([]);
  });

  it("exige a odd de toda seleção seedada (de-vig do mercado completo)", async () => {
    await seedMarket({
      market: "match_result",
      homeScore: 1,
      awayScore: 1,
      sels: {
        home: { odd: "2.000", modelPct: 50 },
        draw: { odd: "3.400", modelPct: 27 },
      },
    });
    expect(await getMarketCalibrationRows()).toEqual([]);
  });

  it("placar sem split (histórico degradado) → pula, não chuta o resultado", async () => {
    await seedMarket({
      market: "btts",
      homeScore: null,
      awayScore: null,
      sels: {
        yes: { odd: "1.800", modelPct: 58 },
        no: { odd: "2.000", modelPct: 42 },
      },
    });
    expect(await getMarketCalibrationRows()).toEqual([]);
  });

  it("filtro `only` restringe os mercados lidos", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    await seedMarket({
      market: "btts",
      homeScore: 1,
      awayScore: 1,
      sels: {
        yes: { odd: "1.800", modelPct: 58 },
        no: { odd: "2.000", modelPct: 42 },
      },
    });
    expect(await getMarketCalibrationRows()).toHaveLength(2);
    const only = await getMarketCalibrationRows(["btts"]);
    expect(only.map((r) => r.marketKey)).toEqual(["btts"]);
  });
});
