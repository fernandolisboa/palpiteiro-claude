import {
  applyScopeFilters,
  applyTableFilters,
  computeBankrollSeries,
  computeGraduation,
  computeSegmentedKpis,
  computeYieldByStakeBand,
  keepLatestPerMatch,
  type BankrollPoint,
  type DashboardFilters,
  type DashboardRow,
  type MarketFilter,
  type StatusFilter,
} from "@/lib/dashboard/kpis";
import { leagueToKey } from "@/lib/format";
import {
  toDashboardKpiView,
  toMarketSegmentView,
  toPredictionRowView,
  type MarketSegmentView,
} from "@/lib/view/dashboard";
import { parseLeagueFilter, type LeagueKey } from "@/lib/view/types";

function parseStatus(value: string | undefined): StatusFilter {
  if (
    value === "pending" ||
    value === "won" ||
    value === "lost" ||
    value === "void" ||
    value === "push"
  ) {
    return value;
  }
  return "all";
}

// Dinâmico (R8): valida o param contra as keys de mercado COM histórico (deduped),
// não contra um literal fixo. Param desconhecido (ou link antigo `over_under_2_5`)
// degrada pra "all" — aceitável, sem contrato externo de URL.
function parseMarket(
  value: string | undefined,
  available: string[],
): MarketFilter {
  return value != null && available.includes(value) ? value : "all";
}

export type AvailableMarket = { key: string; label: string };

/**
 * Keys de mercado COM histórico (deduped), em ordem estável. Exposta pras pages
 * resolverem o filtro de mercado ANTES de derivar a view (parseMarket é dinâmico
 * contra estas keys). Espelha o conjunto que `deriveDashboardView` segmenta.
 */
export function availableMarketKeys(rows: DashboardRow[]): string[] {
  const deduped = keepLatestPerMatch(rows);
  return [...new Set(deduped.map((r) => r.marketKey))];
}

export function parseDashboardFilters(
  sp: {
    status?: string;
    league?: string;
    market?: string;
  },
  availableMarkets: string[] = [],
): DashboardFilters {
  return {
    status: parseStatus(sp.status),
    league: parseLeagueFilter(sp.league),
    market: parseMarket(sp.market, availableMarkets),
  };
}

export type DashboardView = {
  kpis: ReturnType<typeof toDashboardKpiView>;
  segments: MarketSegmentView[];
  series: BankrollPoint[];
  tableRows: ReturnType<typeof toPredictionRowView>[];
  availableLeagues: LeagueKey[];
  availableMarkets: AvailableMarket[];
};

export function deriveDashboardView(
  rows: DashboardRow[],
  filters: DashboardFilters,
  // Fuso de exibição do usuário (#1), forwarded pra a coluna "data" da tabela.
  // Undefined = fuso do runtime (legado/testes).
  timeZone?: string,
): DashboardView {
  // ADR 0020 / #116: conta no máximo uma predição por (jogo, mercado) — a mais
  // recente — em TODOS os outputs (KPIs, gráfico E tabela) pra reanálise não
  // inflar nada. Multi-mercado: cada mercado sobrevive ao dedup (R1).
  const deduped = keepLatestPerMatch(rows);

  // #539: liga e mercado recortam TUDO (KPIs, segmentos, gráfico e tabela); o
  // status só estreita a tabela (ver applyScopeFilters). Dedup antes do recorte:
  // a reanálise mais recente vence independente do filtro.
  const scoped = applyScopeFilters(deduped, filters);

  // Segmentação reusa a conta do agregado por grupo de marketKey → paridade.
  const segmented = computeSegmentedKpis(scoped);
  const segments = segmented.segments.map((segment) =>
    toMarketSegmentView(
      segment,
      computeGraduation(segment.kpis),
      computeYieldByStakeBand(
        scoped.filter((r) => r.marketKey === segment.marketKey),
      ),
    ),
  );

  // Opções dos filtros vêm do histórico INTEIRO (deduped), não do recorte — senão
  // escolher um mercado sumiria com os outros da barra. Ordem = primeira aparição,
  // label de markets.label via join (mesma ordem dos segmentos sem filtro).
  const availableMarkets: AvailableMarket[] = [];
  const seenMarkets = new Set<string>();
  for (const r of deduped) {
    if (seenMarkets.has(r.marketKey)) continue;
    seenMarkets.add(r.marketKey);
    availableMarkets.push({ key: r.marketKey, label: r.marketLabel });
  }

  return {
    kpis: toDashboardKpiView(segmented.aggregate),
    segments,
    series: computeBankrollSeries(scoped),
    tableRows: applyTableFilters(deduped, filters).map((r) =>
      toPredictionRowView(r, timeZone),
    ),
    availableLeagues: [...new Set(deduped.map((r) => leagueToKey(r.league)))],
    availableMarkets,
  };
}
