import { leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { LeagueFilter } from "@/lib/view/types";

/**
 * Linha base do dashboard: uma predição do usuário + (se houver) seu outcome.
 * Colunas `numeric` do Drizzle voltam como STRING — toda aritmética parseia
 * antes (helper `num`). `result/profitUnits/settledAt` são null enquanto não
 * liquidado (LEFT JOIN em prediction_outcomes).
 */
export type DashboardRow = {
  predictionId: string;
  recommendation: "over" | "under" | "pass";
  market: "over_under_2_5";
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  stakeUnits: string;
  oddAtRecommendation: string | null;
  edgePct: string | null;
  confidencePct: string;
  createdAt: Date;
  result: "won" | "lost" | "void" | null;
  profitUnits: string | null;
  settledAt: Date | null;
};

export type RowStatus = "pending" | "won" | "lost" | "void";
export type StatusFilter = "all" | RowStatus;
export type MarketFilter = "all" | "over_under_2_5";

export type DashboardFilters = {
  status: StatusFilter;
  league: LeagueFilter;
  market: MarketFilter;
};

/** Taxa com sua amostra. `value` é null quando o denominador é 0 (mostra "—"). */
export type Rate = { value: number | null; n: number; lowSample: boolean };

export type DashboardKpis = {
  totalPredictions: number;
  bets: number;
  passes: number;
  settled: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  totalProfitUnits: number;
  stakedUnits: number;
  yield: Rate;
  winRate: Rate;
  passRate: Rate;
};

export type BankrollPoint = {
  t: string;
  cumulative: number;
  profit: number;
  label: string;
};

// +50% de yield em 2 apostas é ruído, não skill — sinaliza amostra pequena.
export const LOW_SAMPLE_THRESHOLD = 20;

function num(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function makeRate(numerator: number, denominator: number): Rate {
  return {
    value: denominator > 0 ? (numerator / denominator) * 100 : null,
    n: denominator,
    lowSample: denominator > 0 && denominator < LOW_SAMPLE_THRESHOLD,
  };
}

export function rowStatus(row: DashboardRow): RowStatus {
  return row.result ?? "pending";
}

/**
 * KPIs por usuário sobre TODAS as linhas (a tabela filtra à parte; filtro nunca
 * distorce o KPI de topo). Yield = lucro / volume apostado (stake de bets
 * settled não-pass). Win rate exclui void. Pass rate é sobre todas as predições.
 */
export function computeDashboardKpis(rows: DashboardRow[]): DashboardKpis {
  const totalPredictions = rows.length;
  const passes = rows.filter((r) => r.recommendation === "pass").length;
  const bets = totalPredictions - passes;

  const settledRows = rows.filter((r) => r.result !== null);
  const settled = settledRows.length;
  const pending = totalPredictions - settled;
  const won = settledRows.filter((r) => r.result === "won").length;
  const lost = settledRows.filter((r) => r.result === "lost").length;
  const voided = settledRows.filter((r) => r.result === "void").length;

  const totalProfitUnits = round2(
    sum(settledRows.map((r) => num(r.profitUnits))),
  );
  // Pass não aposta nada e void (jogo anulado) é no-bet → fora do volume do
  // yield. Denominador conta só result IN ('won','lost'); void contribui 0
  // tanto no numerador (profitUnits já é 0) quanto no denominador.
  const settledBets = settledRows.filter(
    (r) => r.recommendation !== "pass" && r.result !== "void",
  );
  const stakedUnits = round2(sum(settledBets.map((r) => num(r.stakeUnits))));

  return {
    totalPredictions,
    bets,
    passes,
    settled,
    pending,
    won,
    lost,
    void: voided,
    totalProfitUnits,
    stakedUnits,
    yield: {
      value: stakedUnits > 0 ? (totalProfitUnits / stakedUnits) * 100 : null,
      n: settledBets.length,
      lowSample:
        settledBets.length > 0 && settledBets.length < LOW_SAMPLE_THRESHOLD,
    },
    winRate: makeRate(won, won + lost),
    passRate: makeRate(passes, totalPredictions),
  };
}

/**
 * Série de bankroll hipotético: P&L acumulado de `profitUnits` por evento de
 * settlement, ordenado por `settledAt`, começando em 0. Linhas não liquidadas
 * (sem `settledAt`) não entram. Sem day-bucketing pra evitar timezone (v0).
 */
export function computeBankrollSeries(rows: DashboardRow[]): BankrollPoint[] {
  const settled = rows
    .filter((r): r is DashboardRow & { settledAt: Date } => r.settledAt !== null)
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());

  let cumulative = 0;
  return settled.map((r) => {
    const profit = round2(num(r.profitUnits));
    cumulative = round2(cumulative + profit);
    return {
      t: r.settledAt.toISOString(),
      cumulative,
      profit,
      label: `${r.homeTeam} × ${r.awayTeam}`,
    };
  });
}

export function applyTableFilters(
  rows: DashboardRow[],
  filters: DashboardFilters,
): DashboardRow[] {
  return rows.filter((r) => {
    if (filters.status !== "all" && rowStatus(r) !== filters.status) {
      return false;
    }
    if (filters.league !== "all" && leagueToKey(r.league) !== filters.league) {
      return false;
    }
    if (filters.market !== "all" && r.market !== filters.market) {
      return false;
    }
    return true;
  });
}
