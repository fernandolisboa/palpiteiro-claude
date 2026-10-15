import { afterEach, describe, expect, it, vi } from "vitest";

import { computeDashboardKpis, type DashboardRow } from "@/lib/dashboard/kpis";
import type { DashboardDetail } from "@/lib/db/queries/dashboard";
import {
  toDashboardKpiView,
  toPredictionDetailView,
  toPredictionRowView,
} from "@/lib/view/dashboard";
import { teamToTeam } from "@/lib/view/team";

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const predictionId = overrides.predictionId ?? "p1";
  return {
    predictionId,
    matchId: `match-${predictionId}`,
    recommendation: "over",
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    league: "world_cup",
    homeTeam: "South Korea",
    awayTeam: "Czech Republic",
    stakeUnits: "1.00",
    oddAtRecommendation: "1.920",
    edgePct: "7.30",
    confidencePct: "58.00",
    createdAt: new Date("2026-06-08T12:00:00Z"),
    result: null,
    profitUnits: null,
    settledAt: null,
    selectionId: null,
    selectionLabel: null,
    marketId: null,
    marketParams: null,
    kickoffAt: new Date("2026-06-08T20:00:00Z"),
    impliedProbPct: null,
    closingOdd: null,
    closingOverroundPct: null,
    isLive: false,
    ...overrides,
  };
}

describe("toPredictionRowView", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("nome curto na linha e oficial no title (#578)", () => {
    const v = toPredictionRowView(
      row({
        league: "champions_league",
        homeTeam: "FC Bayern München",
        awayTeam: "Paris Saint-Germain FC",
      }),
    );
    expect(v.home).toBe("Bayern");
    expect(v.away).toBe("PSG");
    expect(v.title).toBe("FC Bayern München × Paris Saint-Germain FC");
  });

  it("parses numeric strings and maps a settled win", () => {
    const v = toPredictionRowView(
      row({ result: "won", profitUnits: "1.85" }),
    );
    expect(v.rec).toBe("Mais de 2,5");
    expect(v.recKind).toBe("over");
    expect(v.odd).toBe("1,92");
    expect(v.edge).toBe("+7,3 pontos");
    expect(v.confidence).toBe("58%");
    expect(v.status).toBe("won");
    expect(v.profit).toBe("+1,85 u");
  });

  it("renders a negative profit and a pending row", () => {
    expect(toPredictionRowView(row({ result: "lost", profitUnits: "-1.00" })).profit).toBe(
      "-1,00 u",
    );
    const pending = toPredictionRowView(row());
    expect(pending.status).toBe("pending");
    expect(pending.profit).toBeNull();
  });

  it("1X2 na tabela usa a sigla do time no lugar de 'Casa' (#574)", () => {
    const v = toPredictionRowView(
      row({ recommendation: "away", marketKey: "match_result", selectionLabel: "Fora" }),
    );
    expect(v.rec).toBe(teamToTeam("Czech Republic", "wc").short);
    expect(v.rec).not.toBe("Fora");
  });

  it("maps a pass with no entry odd", () => {
    const v = toPredictionRowView(
      row({ recommendation: "pass", oddAtRecommendation: null }),
    );
    expect(v.rec).toBe("Sem aposta");
    expect(v.recKind).toBe("pass");
    expect(v.odd).toBe("—");
  });

  // #539: a tabela não tem coluna de mercado, então a recomendação leva o
  // contexto junto e seleções de jogador usam o nome do DB, não a key crua.
  it("carrega o mercado (+ linha) ao lado da recomendação", () => {
    expect(
      toPredictionRowView(row({ marketParams: { line: 3.5 } })).market,
    ).toBe("Total de gols");
    // A linha vai no rótulo da recomendação; em "Sem aposta" ela fica no contexto.
    expect(toPredictionRowView(row({ marketParams: { line: 3.5 } })).rec).toBe("Mais de 3,5");
    expect(
      toPredictionRowView(row({ recommendation: "pass", marketParams: { line: 3.5 } })).market,
    ).toBe("Total de gols 3,5");
    const btts = toPredictionRowView(
      row({ marketKey: "btts", marketLabel: "Ambas marcam", recommendation: "yes" }),
    );
    expect(btts.rec).toBe("Sim");
    expect(btts.market).toBe("Ambas marcam");
  });

  it("coluna data mostra a data do JOGO, não a da análise (#577)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    const v = toPredictionRowView(
      row({
        createdAt: new Date("2026-06-01T12:00:00Z"),
        kickoffAt: new Date("2026-06-13T19:00:00Z"),
      }),
      "America/Sao_Paulo",
    );
    // 13/06/2026 é sábado; a análise (01/06, segunda) não aparece.
    expect(v.when).toBe("sáb, 13 jun");
  });

  it("coluna data leva o ano quando o jogo é de outro ano (#577)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    const v = toPredictionRowView(
      row({ kickoffAt: new Date("2025-10-18T19:00:00Z") }),
      "America/Sao_Paulo",
    );
    expect(v.when).toBe("sáb, 18 out 2025");
  });

  it("artilheiro mostra o nome do jogador do DB, não a key", () => {
    const v = toPredictionRowView(
      row({
        marketKey: "anytime_scorer",
        marketLabel: "Artilheiro",
        recommendation: "scorer_pedro",
        selectionLabel: "Pedro",
      }),
    );
    expect(v.rec).toBe("Pedro");
    expect(v.market).toBe("Artilheiro");
  });
});

describe("toDashboardKpiView", () => {
  it("shows em-dash for null rates and zero profit on empty data", () => {
    const v = toDashboardKpiView(computeDashboardKpis([]));
    expect(v.yieldPct.value).toBe("—");
    expect(v.yieldPct.n).toBe(0);
    expect(v.totalProfit).toBe("0,00 u");
    expect(v.profitPositive).toBe(true);
  });

  it("carries the sample size and low-sample flag through", () => {
    const v = toDashboardKpiView(
      computeDashboardKpis([
        row({
          result: "won",
          profitUnits: "0.92",
          settledAt: new Date("2026-06-12T20:00:00Z"),
        }),
      ]),
    );
    expect(v.winRate.value).toBe("100%");
    expect(v.winRate.n).toBe(1);
    expect(v.winRate.lowSample).toBe(true);
  });

  it("tons por sinal e retorno com '+' pro resumo (#577)", () => {
    const empty = toDashboardKpiView(computeDashboardKpis([]));
    expect(empty.yieldSigned).toBe("—");
    expect(empty.yieldTone).toBe("zero");
    expect(empty.profitTone).toBe("zero");

    const settledAt = new Date("2026-06-12T20:00:00Z");
    const win = toDashboardKpiView(
      computeDashboardKpis([
        row({ result: "won", profitUnits: "0.92", stakeUnits: "1.00", settledAt }),
      ]),
    );
    expect(win.yieldSigned).toBe("+92,0%");
    expect(win.yieldTone).toBe("positive");
    expect(win.profitTone).toBe("positive");
    // O yieldPct (KpiCards do admin, segmentos) continua sem "+".
    expect(win.yieldPct.value).toBe("92%");

    const loss = toDashboardKpiView(
      computeDashboardKpis([
        row({ result: "lost", profitUnits: "-1.00", stakeUnits: "1.00", settledAt }),
      ]),
    );
    expect(loss.yieldSigned).toBe("-100,0%");
    expect(loss.yieldTone).toBe("negative");
    expect(loss.profitTone).toBe("negative");
  });

  it("perto de zero: texto e tom do mesmo número arredondado, sem sinal (#577)", () => {
    const settledAt = new Date("2026-06-12T20:00:00Z");
    // +0,01 u em 25 u apostadas = +0,04% de retorno: arredonda a zero na tela.
    const up = toDashboardKpiView(
      computeDashboardKpis([
        row({ result: "won", profitUnits: "0.01", stakeUnits: "25.00", settledAt }),
      ]),
    );
    expect(up.yieldSigned).toBe("0,0%");
    expect(up.yieldTone).toBe("zero");
    expect(up.totalProfit).toBe("+0,01 u");
    expect(up.profitTone).toBe("positive");

    const down = toDashboardKpiView(
      computeDashboardKpis([
        row({ result: "lost", profitUnits: "-0.01", stakeUnits: "25.00", settledAt }),
      ]),
    );
    expect(down.yieldSigned).toBe("0,0%");
    expect(down.yieldTone).toBe("zero");
    expect(down.totalProfit).toBe("-0,01 u");
    expect(down.profitTone).toBe("negative");

    // Logo acima da precisão de exibição, o sinal volta junto com a cor.
    const small = toDashboardKpiView(
      computeDashboardKpis([
        row({ result: "won", profitUnits: "0.02", stakeUnits: "4.00", settledAt }),
      ]),
    );
    expect(small.yieldSigned).toBe("+0,5%");
    expect(small.yieldTone).toBe("positive");
  });

  it("formata CLV sinalizado + unidade; '—' sem amostra (#180)", () => {
    const empty = toDashboardKpiView(computeDashboardKpis([]));
    expect(empty.clvOddsRatio.value).toBe("—");
    expect(empty.clvNoVigDelta.value).toBe("—");

    const v = toDashboardKpiView(
      computeDashboardKpis([
        row({ oddAtRecommendation: "2.10", closingOdd: "1.95" }),
      ]),
    );
    expect(v.clvOddsRatio.value.startsWith("+")).toBe(true);
    expect(v.clvOddsRatio.value.endsWith("%")).toBe(true);
    expect(v.clvOddsRatio.n).toBe(1);
    // sem impliedProbPct → no-vig "—" mesmo com a razão-de-odds presente.
    expect(v.clvNoVigDelta.value).toBe("—");
  });
});

// ─── Drill-down + admin gate on raw payloads ─────────────────────────────────

const SYSTEM_PROMPT_MARKER = "SECRET SYSTEM PROMPT";

function makeDetail(overrides: Partial<DashboardDetail> = {}): DashboardDetail {
  const match: DashboardDetail["match"] = {
    id: "m1",
    externalId: "ext-1",
    league: "world_cup",
    homeTeam: "South Korea",
    awayTeam: "Czech Republic",
    kickoffAt: new Date("2026-06-12T02:00:00Z"),
    status: "finished",
    homeScore: 2,
    awayScore: 1,
    neutralVenue: false,
    homeTeamCrestUrl: null,
    awayTeamCrestUrl: null,
    updatedAt: new Date("2026-06-12T05:00:00Z"),
  };
  const prediction: DashboardDetail["prediction"] = {
    id: "p1",
    matchId: "m1",
    userId: "u1",
    aiCallId: "a1",
    market: "over_under_2_5",
    marketId: null,
    selectionId: null,
    marketParams: null,
    recommendation: "over",
    confidencePct: "58.00",
    rationale: "razão",
    keyFactors: ["f1", "f2"],
    minimumOdd: "1.960",
    oddAtRecommendation: "1.920",
    bookmaker: "BetX",
    impliedProbPct: "42.89",
    edgePct: "7.30",
    stakeUnits: "2.00",
    judgments: null,
    modelVersion: "claude-sonnet-4-5-20250929",
    promptVersion: "over_under_v1.2",
    isLive: false,
    liveState: null,
    createdAt: new Date("2026-06-08T01:00:00Z"),
  };
  const aiCall: DashboardDetail["aiCall"] = {
    id: "a1",
    userId: "u1",
    matchId: "m1",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    promptVersion: "over_under_v1.2",
    inputPayload: { system: SYSTEM_PROMPT_MARKER },
    outputPayload: { recommendation: "over" },
    inputTokens: 2345,
    outputTokens: 447,
    latencyMs: 9427,
    costUsd: "0.013740",
    status: "ok",
    errorMessage: null,
    createdAt: new Date("2026-06-08T01:00:09Z"),
  };
  const outcome: DashboardDetail["outcome"] = {
    id: "o1",
    predictionId: "p1",
    resultData: null,
    result: "won",
    profitUnits: "1.84",
    overrideByUserId: null,
    settledAt: new Date("2026-06-12T05:00:00Z"),
  };
  // marketKey null por padrão (row sem marketId → LEFT JOIN markets devolve null),
  // exatamente o caso histórico over/under: o view-mapper coalesce null→"over_under",
  // então a saída fica byte-idêntica à anterior (sem o join).
  return {
    prediction,
    match,
    outcome,
    aiCall,
    marketKey: null,
    marketLabel: null,
    selectionLabel: null,
    ...overrides,
  };
}

describe("toPredictionDetailView", () => {
  it("row templada do best bet code_jev (#512): sem a ai_call compartilhada (custo/tokens/payloads)", () => {
    const base = makeDetail();
    const templated = makeDetail({
      prediction: {
        ...base.prediction,
        judgments: {
          narration: "best_bet_template",
        } as DashboardDetail["prediction"]["judgments"],
      },
    });
    const v = toPredictionDetailView(templated, { includeRawPayloads: true });
    expect(v.aiCall).toBeNull();
    expect(v.rawPayloads).toBeNull();
    // A que fez a própria narração segue mostrando a chamada.
    const own = makeDetail({
      prediction: {
        ...base.prediction,
        judgments: {
          narration: "llm_call",
        } as DashboardDetail["prediction"]["judgments"],
      },
    });
    const ov = toPredictionDetailView(own, { includeRawPayloads: true });
    expect(ov.aiCall?.costUsd).toBe("$0.014");
    expect(ov.rawPayloads).not.toBeNull();
  });

  it("hides raw payloads (system prompt) from non-admins", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
    });
    expect(v.rawPayloads).toBeNull();
    // ...but the structured view + ai-call meta are still visible to the owner
    expect(v.aiCall?.inputTokens).toBe(2345);
    expect(v.aiCall?.outputTokens).toBe(447);
    expect(v.aiCall?.costUsd).toBe("$0.014");
  });

  it("exposes raw payloads only when includeRawPayloads is true (admin)", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: true,
    });
    expect(v.rawPayloads).not.toBeNull();
    expect(v.rawPayloads?.input).toContain(SYSTEM_PROMPT_MARKER);
  });

  it("título do detalhe com o nome curto (#578)", () => {
    const base = makeDetail();
    const v = toPredictionDetailView(
      makeDetail({
        match: {
          ...base.match,
          league: "brasileirao_a",
          homeTeam: "SE Palmeiras",
          awayTeam: "CR Flamengo",
        },
      }),
      { includeRawPayloads: false },
    );
    expect(v.match.home).toBe("Palmeiras");
    expect(v.match.away).toBe("Flamengo");
  });

  it("parses numeric stake/profit at the view boundary", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
    });
    expect(v.prediction.stake).toBe("2,00 u");
    expect(v.outcome?.profit).toBe("+1,84 u");
    expect(v.match.score).toBe("2-1");
    // Fase 5: o dashboard parou de ler a coluna legada total_goals. Uma row
    // histórica pré-backfill (resultData null) degrada honestamente pra "—" no
    // drill-down (NUNCA fabrica o "3" da coluna — prefer skip over silent wrong
    // settle). Rows reais têm resultData populado pelo backfill #162 ANTES do DROP
    // (gate §6 D); o caso resultData-presente é coberto pelo teste seguinte.
    expect(v.outcome?.settlementMetric).toEqual({
      label: "gols (90')",
      value: "—",
    });
    // O escalar legado `totalGoals` saiu da view no contract (#170) — só
    // settlementMetric carrega o fato do settlement agora.
    expect(v.outcome).not.toHaveProperty("totalGoals");
  });

  it("settlementMetric prefers resultData.totalGoals when present", () => {
    const v = toPredictionDetailView(
      makeDetail({
        outcome: {
          id: "o1",
          predictionId: "p1",
          resultData: { homeScore: 2, awayScore: 2, totalGoals: 4 },
          result: "won",
          profitUnits: "1.84",
          overrideByUserId: null,
          settledAt: new Date("2026-06-12T05:00:00Z"),
        },
      }),
      { includeRawPayloads: false },
    );
    expect(v.outcome?.settlementMetric).toEqual({
      label: "gols (90')",
      value: "4",
    });
  });

  it("maps a still-pending prediction", () => {
    const v = toPredictionDetailView(makeDetail({ outcome: null }), {
      includeRawPayloads: true,
    });
    expect(v.outcome).toBeNull();
  });

  it("1X2 (match_result): rec mostra o nome do time (não 'home'/'Casa') e settlementMetric usa o label do mercado", () => {
    // Antes do join de markets a detail view hardcodava "over_under": uma row 1X2
    // renderizava o token cru "home" e o label de gols. Com o marketKey resolvido,
    // recToken deriva o label da seleção da apresentação e o settlementMetric o do
    // mercado certo.
    const base = makeDetail();
    const v = toPredictionDetailView(
      {
        ...base,
        marketKey: "match_result",
        prediction: {
          ...base.prediction,
          market: null,
          recommendation: "home",
          // 1X2 não carrega o par binário over/under.
          promptVersion: "match_result_v1",
        },
        outcome: {
          id: "o1",
          predictionId: "p1",
          resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
          result: "won",
          profitUnits: "1.10",
          overrideByUserId: null,
          settledAt: new Date("2026-06-12T05:00:00Z"),
        },
      },
      { includeRawPayloads: false },
    );
    // Nome de EXIBIÇÃO do mandante (#574): "South Korea" da Copa vira "Coreia do Sul".
    expect(v.prediction.rec).toBe("Coreia do Sul");
    // Sem markets.label no detalhe, cai no label da apresentação.
    expect(v.prediction.market).toBe("Resultado (1X2)");
    expect(v.outcome?.settlementMetric.label).toBe("resultado (90')");
    // settlementMetricValue registry-driven: 1X2 mostra o placar (antes mostrava
    // o escalar de gols "3" — bug latente corrigido junto com o deriver do #174).
    expect(v.outcome?.settlementMetric.value).toBe("2-1");
  });

  it("btts: rec mostra 'Sim' e settlementMetric mostra Sim/Não a partir do split", () => {
    const base = makeDetail();
    const mkBtts = (homeScore: number, awayScore: number) =>
      toPredictionDetailView(
        {
          ...base,
          marketKey: "btts",
          prediction: {
            ...base.prediction,
            market: null,
            recommendation: "yes",
            promptVersion: "btts_v1",
          },
          outcome: {
            id: "o1",
            predictionId: "p1",
            resultData: { homeScore, awayScore, totalGoals: homeScore + awayScore },
            result: "won",
            profitUnits: "1.06",
            overrideByUserId: null,
            settledAt: new Date("2026-06-12T05:00:00Z"),
          },
        },
        { includeRawPayloads: false },
      );

    const won = mkBtts(1, 1);
    expect(won.prediction.rec).toBe("Sim");
    expect(won.outcome?.settlementMetric.label).toBe("ambas marcam (90')");
    expect(won.outcome?.settlementMetric.value).toBe("Sim");
    // 2-0: só um lado marcou → "Não". 0-0: ninguém marcou → "Não".
    expect(mkBtts(2, 0).outcome?.settlementMetric.value).toBe("Não");
    expect(mkBtts(0, 0).outcome?.settlementMetric.value).toBe("Não");
  });

  it("assistência: rec usa o label da seleção do DB (#539)", () => {
    const base = makeDetail();
    const v = toPredictionDetailView(
      {
        ...base,
        marketKey: "assist",
        marketLabel: "Assistência",
        selectionLabel: "Arrascaeta",
        prediction: {
          ...base.prediction,
          market: null,
          recommendation: "assist_arrascaeta",
          marketParams: null,
        },
      },
      { includeRawPayloads: false },
    );
    expect(v.prediction.rec).toBe("Arrascaeta");
    expect(v.prediction.market).toBe("Assistência");
  });

  it("marketKey null (histórica sem marketId): coalesce over_under → saída byte-idêntica", () => {
    // Espelha a row pré-backfill (LEFT JOIN markets → null). O view-mapper coalesce
    // pra over_under: rec pinado e label de gols, exatamente como antes do join.
    const v = toPredictionDetailView(makeDetail({ marketKey: null }), {
      includeRawPayloads: false,
    });
    expect(v.prediction.rec).toBe("Mais de 2,5");
    expect(v.outcome?.settlementMetric.label).toBe("gols (90')");
  });

  it("shows the real bookmaker on a pass prediction (frozen pair era, ADR 0012)", () => {
    // Pass novas persistem bookmaker = fonte das odds analisadas — mudança
    // aceita da #104; pass históricas (bookmaker null) seguem em "—".
    const base = makeDetail({ outcome: null });
    const v = toPredictionDetailView(
      {
        ...base,
        prediction: {
          ...base.prediction,
          recommendation: "pass",
          minimumOdd: null,
          oddAtRecommendation: null,
          impliedProbPct: null,
          edgePct: null,
          bookmaker: "BetX",
        },
      },
      { includeRawPayloads: false },
    );
    expect(v.prediction.rec).toBe("Sem aposta");
    expect(v.prediction.bookmaker).toBe("BetX");
    expect(v.prediction.odd).toBe("—");

    const legacy = toPredictionDetailView(
      {
        ...base,
        prediction: {
          ...base.prediction,
          recommendation: "pass",
          minimumOdd: null,
          oddAtRecommendation: null,
          impliedProbPct: null,
          edgePct: null,
          bookmaker: null,
        },
      },
      { includeRawPayloads: false },
    );
    expect(legacy.prediction.bookmaker).toBe("—");
  });

  it("CLV por predição com closing line (#180): odd de fechamento + métricas sinalizadas", () => {
    // makeDetail: oddRec 1.920, impliedProbPct 42.89, marketKey null → over_under (impliedSumTarget 1).
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
      closing: {
        oddClose: "1.850",
        overroundPctClose: "4.50",
        bookmaker: "BetY",
        capturedAt: new Date("2026-06-12T01:55:00Z"),
      },
    });
    expect(v.clv.available).toBe(true);
    expect(v.clv.closingOdd).toBe("1,85");
    // oddRec 1.92 > close 1.85 → bati o fechamento → +
    expect(v.clv.oddsRatioPct.startsWith("+")).toBe(true);
    expect(v.clv.oddsRatioPct.endsWith("%")).toBe(true);
    expect(v.clv.noVigDeltaPp.endsWith(" pp")).toBe(true);
  });

  it("CLV ausente sem closing line capturada → tudo '—', available false", () => {
    const v = toPredictionDetailView(makeDetail(), {
      includeRawPayloads: false,
    });
    expect(v.clv.available).toBe(false);
    expect(v.clv.closingOdd).toBe("—");
    expect(v.clv.oddsRatioPct).toBe("—");
    expect(v.clv.noVigDeltaPp).toBe("—");
  });
});
