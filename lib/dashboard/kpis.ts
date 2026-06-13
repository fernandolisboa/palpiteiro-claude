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
  matchId: string;
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
  result: "won" | "lost" | "void" | "push" | null;
  profitUnits: string | null;
  settledAt: Date | null;
};

// `push` entra no enum no expand da Fase 1 (#161), mas NENHUM caminho o emite ou o
// torna selecionável ainda (settlement plugável = Fase 2 #166). Os tipos derivados
// do enum o carregam por consistência; com zero rows push os KPIs são byte-idênticos.
// Semântica futura (ADR 0016 §5): push é no-action (devolve stake) — excluído do
// yield como o void; #171 segmenta por mercado e formaliza o tratamento.
export type RowStatus = "pending" | "won" | "lost" | "void" | "push";
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
 * Dedup de reanálise (ADR 0020 / #116): mantém só a predição mais recente por
 * jogo — a de maior `createdAt`. Reanalisar um jogo cria uma predição nova
 * (CLAUDE.md: nunca mutar predição passada); sem dedup, cada reanálise infla
 * yield/winRate/passRate/bankroll. As antigas continuam no banco como histórico,
 * só não contam pros KPIs.
 *
 * Keyed por `matchId` (o `userId` já está fixo pelo escopo da query). A chave se
 * estende a `(matchId, market)` quando o pivot trouxer mais mercados; a
 * segmentação de KPIs por mercado do #171 é um passo de agrupamento separado, em
 * cima do conjunto já deduplicado.
 *
 * Order-independent: compara `createdAt` explicitamente (não assume a ordenação
 * da query). Em empate de `createdAt`, vence o primeiro visto.
 */
export function keepLatestPerMatch(rows: DashboardRow[]): DashboardRow[] {
  const latest = new Map<string, DashboardRow>();
  for (const row of rows) {
    const current = latest.get(row.matchId);
    if (current == null || row.createdAt > current.createdAt) {
      latest.set(row.matchId, row);
    }
  }
  return [...latest.values()];
}

/**
 * KPIs por usuário sobre TODAS as linhas (a tabela filtra à parte; filtro nunca
 * distorce o KPI de topo). Yield = Σ profitUnits / Σ stake, ambos sobre o MESMO
 * conjunto de bets settled com result IN ('won','lost') — pass E void ficam de
 * fora do numerador e do denominador (não movem o yield). Win rate exclui void.
 * Pass rate é sobre todas as predições.
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
  // tanto no numerador quanto no denominador.
  const settledBets = settledRows.filter(
    (r) =>
      r.recommendation !== "pass" &&
      r.result !== "void" &&
      r.result !== "push",
  );
  const stakedUnits = round2(sum(settledBets.map((r) => num(r.stakeUnits))));
  // Numerador do yield sobre o MESMO conjunto won/lost do denominador: a
  // exclusão de void é estrutural, não depende de void.profitUnits === 0.
  const settledBetsProfit = round2(
    sum(settledBets.map((r) => num(r.profitUnits))),
  );

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
      value: stakedUnits > 0 ? (settledBetsProfit / stakedUnits) * 100 : null,
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
