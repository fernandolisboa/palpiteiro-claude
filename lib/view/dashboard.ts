import type { DashboardDetail } from "@/lib/db/queries/dashboard";
import type {
  BankrollPoint,
  DashboardKpis,
  DashboardRow,
  Graduation,
  MarketSegmentKpis,
  Rate,
  StakeBandYield,
} from "@/lib/dashboard/kpis";
import { rowStatus } from "@/lib/dashboard/kpis";
import {
  formatCostUsd,
  formatEdge,
  formatKickoffAbsolute,
  formatModelName,
  formatOdd,
  formatPct,
  formatStakeUnits,
  formatUnitsSigned,
  leagueToKey,
} from "@/lib/format";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { LeagueKey, Recommendation } from "@/lib/view/types";

// Tokens pinados do over/under (paridade byte-idêntica). pass é market-agnóstico.
const REC_TOKEN_OVER_UNDER: Record<string, Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

// Display da recomendação TOTAL p/ qualquer mercado (#173). over/under/pass usam o
// token pinado; mercados novos derivam o label da seleção da apresentação (via
// marketKey da row) — ex.: 1X2 → "Casa"/"Empate"/"Fora". `pass` nunca é uma
// seleção de mercado, então cai no token pinado independentemente do marketKey.
function recToken(
  recommendation: DashboardRow["recommendation"],
  marketKey: string,
): Recommendation {
  if (recommendation in REC_TOKEN_OVER_UNDER) {
    return REC_TOKEN_OVER_UNDER[recommendation];
  }
  return getMarketPresentation(marketKey).selectionLabel(recommendation);
}

// Unidades COM sinal — convenção única, centralizada em lib/format (#170).
const unitsLabel = formatUnitsSigned;

// ─── KPIs ──────────────────────────────────────────────────────────────────

export type RateView = { value: string; n: number; lowSample: boolean };

export type DashboardKpiView = {
  yieldPct: RateView;
  winRate: RateView;
  passRate: RateView;
  totalProfit: string;
  profitPositive: boolean;
  counts: {
    total: number;
    bets: number;
    passes: number;
    settled: number;
    pending: number;
    won: number;
    lost: number;
    void: number;
  };
};

function toRateView(rate: Rate): RateView {
  return { value: formatPct(rate.value), n: rate.n, lowSample: rate.lowSample };
}

export function toDashboardKpiView(kpis: DashboardKpis): DashboardKpiView {
  return {
    yieldPct: toRateView(kpis.yield),
    winRate: toRateView(kpis.winRate),
    passRate: toRateView(kpis.passRate),
    totalProfit: unitsLabel(kpis.totalProfitUnits),
    profitPositive: kpis.totalProfitUnits >= 0,
    counts: {
      total: kpis.totalPredictions,
      bets: kpis.bets,
      passes: kpis.passes,
      settled: kpis.settled,
      pending: kpis.pending,
      won: kpis.won,
      lost: kpis.lost,
      void: kpis.void,
    },
  };
}

// ─── Segmento por mercado: régua D9 + bandas de stake (#171) ─────────────────

export type GraduationView = {
  resolved: number;
  target: number;
  graduated: boolean;
  // "12 / 30 resolvidas" — string pronta pra render.
  label: string;
};

export function toGraduationView(graduation: Graduation): GraduationView {
  return {
    resolved: graduation.resolved,
    target: graduation.target,
    graduated: graduation.graduated,
    label: `${graduation.resolved} / ${graduation.target} resolvidas`,
  };
}

export type StakeBandView = {
  band: string;
  yieldPct: RateView;
  profit: string;
};

export function toStakeBandView(band: StakeBandYield): StakeBandView {
  return {
    band: band.band,
    yieldPct: toRateView(band.yield),
    profit: unitsLabel(band.totalProfitUnits),
  };
}

export type MarketSegmentView = {
  marketKey: string;
  marketLabel: string;
  kpis: DashboardKpiView;
  graduation: GraduationView;
  stakeBands: StakeBandView[];
  // Segmento sem nenhuma aposta resolvida (yield.n === 0) → a régua/bandas
  // degradam pra "—"; sinaliza pra UI mostrar estado claro de "ainda sem dados".
  empty: boolean;
};

export function toMarketSegmentView(
  segment: MarketSegmentKpis,
  graduation: Graduation,
  stakeBands: StakeBandYield[],
): MarketSegmentView {
  return {
    marketKey: segment.marketKey,
    marketLabel: segment.marketLabel,
    kpis: toDashboardKpiView(segment.kpis),
    graduation: toGraduationView(graduation),
    stakeBands: stakeBands.map(toStakeBandView),
    empty: segment.kpis.yield.n === 0,
  };
}

// ─── Linha da tabela ─────────────────────────────────────────────────────────

export type PredictionRowView = {
  id: string;
  home: string;
  away: string;
  league: LeagueKey;
  when: string;
  rec: Recommendation;
  odd: string;
  edge: string | null;
  confidence: string;
  status: "pending" | "won" | "lost" | "void" | "push";
  profit: string | null;
};

export function toPredictionRowView(row: DashboardRow): PredictionRowView {
  const profitNum = row.profitUnits === null ? null : Number(row.profitUnits);
  return {
    id: row.predictionId,
    home: row.homeTeam,
    away: row.awayTeam,
    league: leagueToKey(row.league),
    when: formatKickoffAbsolute(row.createdAt),
    rec: recToken(row.recommendation, row.marketKey),
    odd: formatOdd(row.oddAtRecommendation),
    edge: formatEdge(row.edgePct),
    confidence: formatPct(row.confidencePct),
    status: rowStatus(row),
    profit:
      profitNum !== null && Number.isFinite(profitNum)
        ? unitsLabel(profitNum)
        : null,
  };
}

// ─── Gráfico (passa direto pro client component) ─────────────────────────────

export type BankrollChartPoint = BankrollPoint;

// ─── Drill-down ──────────────────────────────────────────────────────────────

const RAW_PAYLOAD_MAX = 20_000;

function stringifyPayload(payload: unknown): string {
  const json = JSON.stringify(payload, null, 2) ?? "null";
  return json.length > RAW_PAYLOAD_MAX
    ? `${json.slice(0, RAW_PAYLOAD_MAX)}\n… (truncado — ${json.length} chars)`
    : json;
}

export type PredictionDetailView = {
  id: string;
  match: {
    home: string;
    away: string;
    league: LeagueKey;
    kickoff: string;
    status: string;
    score: string;
  };
  prediction: {
    rec: Recommendation;
    confidence: string;
    edge: string | null;
    implied: string;
    minOdd: string;
    odd: string;
    stake: string;
    bookmaker: string;
    rationale: string;
    factors: string[];
    model: string;
    promptVersion: string;
    createdAt: string;
  };
  outcome: {
    result: "won" | "lost" | "void" | "push";
    profit: string;
    // Métrica de settlement market-aware: label do mercado + valor do fato do
    // jogo. Substituiu o Row legado "gols (90')" + o escalar `totalGoals` no
    // contract da view (#170). A COLUNA de DB total_goals segue (legacy, Fase 5).
    settlementMetric: { label: string; value: string };
    settledAt: string;
    manual: boolean;
  } | null;
  aiCall: {
    model: string;
    promptVersion: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    latencyMs: number;
    status: string;
  } | null;
  // Só populado quando o chamador é admin (protege o system prompt no inputPayload).
  rawPayloads: { input: string; output: string } | null;
};

export function toPredictionDetailView(
  detail: DashboardDetail,
  opts: { includeRawPayloads: boolean },
): PredictionDetailView {
  const { prediction, match, outcome, aiCall } = detail;
  const score =
    match.homeScore !== null && match.awayScore !== null
      ? `${match.homeScore}-${match.awayScore}`
      : "—";

  // Key do mercado resolvida pela query (LEFT JOIN markets). Coalesce null→
  // "over_under" pras rows sem marketId (históricas pré-backfill), igual ao
  // getUserDashboardRows. Alimenta recToken (display da seleção) E o label da
  // métrica de settlement.
  const marketKey = detail.marketKey ?? "over_under";

  return {
    id: prediction.id,
    match: {
      home: match.homeTeam,
      away: match.awayTeam,
      league: leagueToKey(match.league),
      kickoff: formatKickoffAbsolute(match.kickoffAt),
      status: match.status,
      score,
    },
    prediction: {
      // marketKey resolvido pela query (LEFT JOIN markets); over/under/pass usam o
      // token pinado (não consultam marketKey → byte-idêntico), mercados novos (1X2)
      // derivam o display da seleção da apresentação ("Casa"/"Empate"/"Fora").
      rec: recToken(prediction.recommendation, marketKey),
      confidence: formatPct(prediction.confidencePct),
      edge: formatEdge(prediction.edgePct),
      implied: formatPct(prediction.impliedProbPct),
      minOdd: formatOdd(prediction.minimumOdd),
      odd: formatOdd(prediction.oddAtRecommendation),
      stake: formatStakeUnits(prediction.stakeUnits) ?? "—",
      bookmaker: prediction.bookmaker ?? "—",
      rationale: prediction.rationale,
      factors: prediction.keyFactors,
      model: formatModelName(prediction.modelVersion),
      promptVersion: prediction.promptVersion,
      createdAt: formatKickoffAbsolute(prediction.createdAt),
    },
    outcome: outcome
      ? {
          result: outcome.result,
          profit: unitsLabel(Number(outcome.profitUnits)),
          // VALOR do escalar notNull `total_goals` (resultData é nullable em
          // históricas — schema; cruza com resultData.totalGoals quando existe).
          // Label da apresentação do mercado RESOLVIDO da row (marketKey do join).
          settlementMetric: {
            label: getMarketPresentation(marketKey).settlementMetricLabel,
            value: String(outcome.resultData?.totalGoals ?? outcome.totalGoals),
          },
          settledAt: formatKickoffAbsolute(outcome.settledAt),
          manual: outcome.overrideByUserId !== null,
        }
      : null,
    aiCall: aiCall
      ? {
          model: formatModelName(aiCall.model),
          promptVersion: aiCall.promptVersion,
          inputTokens: aiCall.inputTokens,
          outputTokens: aiCall.outputTokens,
          costUsd: formatCostUsd(aiCall.costUsd),
          latencyMs: aiCall.latencyMs,
          status: aiCall.status,
        }
      : null,
    rawPayloads:
      opts.includeRawPayloads && aiCall
        ? {
            input: stringifyPayload(aiCall.inputPayload),
            output: stringifyPayload(aiCall.outputPayload),
          }
        : null,
  };
}
