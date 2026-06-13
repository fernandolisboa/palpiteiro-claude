import type { DashboardDetail } from "@/lib/db/queries/dashboard";
import type {
  BankrollPoint,
  DashboardKpis,
  DashboardRow,
  Rate,
} from "@/lib/dashboard/kpis";
import { rowStatus } from "@/lib/dashboard/kpis";
import {
  formatCostUsd,
  formatEdge,
  formatKickoffAbsolute,
  formatModelName,
  formatOdd,
  formatPct,
  leagueToKey,
} from "@/lib/format";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { LeagueKey, Recommendation } from "@/lib/view/types";

const REC_MAP: Record<DashboardRow["recommendation"], Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

// Toda string `numeric` do Drizzle vira número ANTES de qualquer conta/format.
function unitsLabel(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} u`;
}

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
    rec: REC_MAP[row.recommendation],
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
    totalGoals: number;
    // Métrica de settlement market-aware (#169, additive): label do mercado +
    // valor do fato do jogo. O #170 troca o Row legado "gols (90')" por esta e
    // remove `totalGoals` (a "troca" do issue completa no contract da view).
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
      rec: REC_MAP[prediction.recommendation],
      confidence: formatPct(prediction.confidencePct),
      edge: formatEdge(prediction.edgePct),
      implied: formatPct(prediction.impliedProbPct),
      minOdd: formatOdd(prediction.minimumOdd),
      odd: formatOdd(prediction.oddAtRecommendation),
      stake: unitsLabel(Number(prediction.stakeUnits)).replace("+", ""),
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
          totalGoals: outcome.totalGoals,
          // VALOR do escalar notNull `total_goals` (resultData é nullable em
          // históricas — schema; cruza com resultData.totalGoals quando existe).
          // Label da apresentação do mercado. Default over_under até o #170/Fase 4
          // resolver o marketKey da row — over/under é o único ativo.
          settlementMetric: {
            label: getMarketPresentation("over_under").settlementMetricLabel,
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
