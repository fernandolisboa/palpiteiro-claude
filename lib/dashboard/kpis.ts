import { leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { LeagueFilter } from "@/lib/view/types";

/**
 * Linha base do dashboard: uma predição do usuário + (se houver) seu outcome.
 * Colunas `numeric` do Drizzle voltam como STRING — toda aritmética parseia
 * antes (helper `num`). `result/profitUnits/settledAt` são null enquanto não
 * liquidado (LEFT JOIN em prediction_outcomes).
 *
 * `marketKey`/`marketLabel` são a CHAVE CANÔNICA de mercado (de `markets.key`,
 * via LEFT JOIN na query), NÃO o enum legado `predictions.market`. Rows sem
 * `marketId` (históricas pré-backfill) caem no fallback enum→key na borda da
 * query (`over_under_2_5 → over_under`), nunca chegam aqui com key null.
 */
export type DashboardRow = {
  predictionId: string;
  matchId: string;
  // = a key da seleção escolhida (multi-mercado, #173) ou "pass" (no-bet). Antes
  // fechado em over/under; alargado p/ as keys 1X2 (home/draw/away) com a ativação
  // do mercado. A view deriva o display da seleção+apresentação (REC_MAP total).
  recommendation: "over" | "under" | "pass" | "home" | "draw" | "away";
  marketKey: string;
  marketLabel: string;
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
// Aberto: o filtro de mercado é uma `markets.key` canônica qualquer (dinâmico),
// "all" = sem filtro. Não mais pinado ao enum legado over_under_2_5.
export type MarketFilter = "all" | string;

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
 * `(matchId, marketKey)` — a de maior `createdAt`. Reanalisar um jogo cria uma
 * predição nova (CLAUDE.md: nunca mutar predição passada); sem dedup, cada
 * reanálise infla yield/winRate/passRate/bankroll. As antigas continuam no banco
 * como histórico, só não contam pros KPIs.
 *
 * Keyed por `(matchId, marketKey)` (ADR 0015 D6; o `userId` já está fixo pelo
 * escopo da query): com 2+ mercados no MESMO jogo, cada mercado é uma aposta
 * independente — chavear só por matchId DROPARIA uma seleção do agregado E do
 * segmento. Hoje predict.ts grava 1 mercado/jogo, então a paridade não muda; a
 * segmentação só fica CORRETA (não coincidentemente-correta) com a chave composta.
 *
 * Order-independent: compara `createdAt` explicitamente (não assume a ordenação
 * da query). Em empate de `createdAt`, vence o primeiro visto.
 */
export function keepLatestPerMatch(rows: DashboardRow[]): DashboardRow[] {
  const latest = new Map<string, DashboardRow>();
  for (const row of rows) {
    const key = `${row.matchId}|${row.marketKey}`;
    const current = latest.get(key);
    if (current == null || row.createdAt > current.createdAt) {
      latest.set(key, row);
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

// ─── Segmentação por mercado (#171) ──────────────────────────────────────────

export type MarketSegmentKpis = {
  marketKey: string;
  marketLabel: string;
  kpis: DashboardKpis;
};

export type SegmentedKpis = {
  aggregate: DashboardKpis;
  segments: MarketSegmentKpis[];
};

/**
 * KPIs agregados (sobre TODAS as rows) + um `computeDashboardKpis` por grupo de
 * `marketKey`. A função de conta é REUSADA sem mudança → paridade: com um único
 * mercado no histórico, `aggregate` é byte-a-byte igual ao único segmento. Os
 * segmentos saem em ordem estável (primeira aparição da `marketKey` nas rows).
 */
export function computeSegmentedKpis(rows: DashboardRow[]): SegmentedKpis {
  const order: string[] = [];
  const byKey = new Map<string, DashboardRow[]>();
  const labelByKey = new Map<string, string>();
  for (const row of rows) {
    if (!byKey.has(row.marketKey)) {
      byKey.set(row.marketKey, []);
      labelByKey.set(row.marketKey, row.marketLabel);
      order.push(row.marketKey);
    }
    byKey.get(row.marketKey)!.push(row);
  }
  return {
    aggregate: computeDashboardKpis(rows),
    segments: order.map((marketKey) => ({
      marketKey,
      marketLabel: labelByKey.get(marketKey)!,
      kpis: computeDashboardKpis(byKey.get(marketKey)!),
    })),
  };
}

// ─── Régua de graduação D9 (ADR 0015 D9) ─────────────────────────────────────

// Um mercado "gradua" com ≥30 apostas RESOLVIDAS (won+lost; exclui pass/void/push)
// E Yield positivo (ADR 0015 D9). Display-only — NÃO escreve markets.is_graduated
// (write path/migration = scope creep); só exibe a régua "N/30 + badge".
export const GRADUATION_MIN_RESOLVED = 30;

export type Graduation = {
  resolved: number;
  target: number;
  graduated: boolean;
};

/**
 * Régua D9 sobre os MESMOS KPIs do segmento. "resolvidas" = `yield.n` (o conjunto
 * won/lost do Yield), não `settled` (que conta void/push). `graduated` guarda o
 * null do denominador zero: yield.value null (zero apostas resolvidas) → false.
 */
export function computeGraduation(kpis: DashboardKpis): Graduation {
  const resolved = kpis.yield.n;
  const value = kpis.yield.value;
  return {
    resolved,
    target: GRADUATION_MIN_RESOLVED,
    graduated:
      resolved >= GRADUATION_MIN_RESOLVED && value != null && value > 0,
  };
}

// ─── Breakdown por banda de stake (#167 / ADR 0019 §5) ───────────────────────

export type StakeBandKey = "1u" | "2u" | "3u";

export type StakeBandYield = {
  band: StakeBandKey;
  yield: Rate;
  totalProfitUnits: number;
  stakedUnits: number;
};

const STAKE_BANDS: StakeBandKey[] = ["1u", "2u", "3u"];

/**
 * Yield independente por banda de stake (1u/2u/3u). Escopa ao MESMO settledBets do
 * Yield agregado (exclui pass/void/push) ANTES de bucketar — senão um pass (stake
 * "1.00") infla a banda 1u. Banda = `Math.round(num(stakeUnits)) ∈ {1,2,3}`; cada
 * banda tem num/den próprios. Paridade: histórico só 1u (ADR 0019 §6) → toda bet
 * cai na banda 1u, cujo yield == o agregado. Bandas sempre presentes (vazias = "—").
 */
export function computeYieldByStakeBand(
  rows: DashboardRow[],
): StakeBandYield[] {
  const settledBets = rows.filter(
    (r) =>
      r.recommendation !== "pass" &&
      r.result !== null &&
      r.result !== "void" &&
      r.result !== "push",
  );
  const byBand = new Map<StakeBandKey, DashboardRow[]>();
  for (const band of STAKE_BANDS) byBand.set(band, []);
  for (const r of settledBets) {
    const rounded = Math.round(num(r.stakeUnits));
    if (rounded >= 1 && rounded <= 3) {
      byBand.get(`${rounded}u` as StakeBandKey)!.push(r);
    }
  }
  return STAKE_BANDS.map((band) => {
    const bets = byBand.get(band)!;
    const stakedUnits = round2(sum(bets.map((r) => num(r.stakeUnits))));
    const profit = round2(sum(bets.map((r) => num(r.profitUnits))));
    return {
      band,
      totalProfitUnits: profit,
      stakedUnits,
      yield: {
        value: stakedUnits > 0 ? (profit / stakedUnits) * 100 : null,
        n: bets.length,
        lowSample: bets.length > 0 && bets.length < LOW_SAMPLE_THRESHOLD,
      },
    };
  });
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
    if (filters.market !== "all" && r.marketKey !== filters.market) {
      return false;
    }
    return true;
  });
}
