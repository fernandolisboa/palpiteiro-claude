import { formatOdd, formatPct, formatRelativeAgoLabel } from "@/lib/format";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import type { DixonColesFallbackReason } from "@/lib/quant/match-model";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type {
  MatchModelLineView,
  MatchModelReadingView,
} from "@/lib/view/types";

// Mappers PUROS da base do modelo por jogo (#555, ADR 0052) pra linha do /jogos e pro
// bloco "Leitura do modelo". Só probabilidade e odd justa: nada de odd da casa, edge,
// EV ou stake (a base não expõe valor; o edge fica na análise, com o gate).

const intPct = (pp: number) => `${Math.round(pp)}%`;

/** Favorito do 1X2 (empate de pp → casa, empate, fora) e o lado mais provável do 2.5. */
export function toMatchModelLineView(
  snapshot: MatchModelSnapshot,
): MatchModelLineView {
  const mr = snapshot.probabilities.match_result;
  const mrLabels = getMarketPresentation("match_result");
  let favorite: "home" | "draw" | "away" = "home";
  if (mr.draw > mr[favorite]) favorite = "draw";
  if (mr.away > mr[favorite]) favorite = "away";

  const ou = snapshot.probabilities.over_under["2.5"];
  const side = ou.under > ou.over ? "under" : "over";
  const ouLabels = getMarketPresentation("over_under");
  return {
    favorite: {
      label: mrLabels.outcomeLabel(favorite, null),
      pct: intPct(mr[favorite]),
    },
    goals25: {
      label: ouLabels.outcomeLabel(side, 2.5),
      pct: intPct(ou[side]),
    },
  };
}

const FALLBACK_LABEL: Record<DixonColesFallbackReason, string> = {
  flag_off: "Dixon-Coles desligado",
  no_fit: "liga sem ajuste",
  stale_fit: "ajuste desatualizado",
  team_missing: "time sem histórico",
  few_matches: "pouco histórico",
  error: "erro nos ratings",
};

function sourceLabel(snapshot: MatchModelSnapshot): string {
  const base =
    snapshot.lambdaSource === "dixon_coles"
      ? "Dixon-Coles"
      : snapshot.lambdaFallbackReason
        ? `heurístico da tabela (${FALLBACK_LABEL[snapshot.lambdaFallbackReason]})`
        : "heurístico da tabela";
  return snapshot.lambdaDegraded ? `${base} · dados limitados` : base;
}

function selection(label: string, pp: number) {
  return {
    label,
    pct: formatPct(pp, { decimals: 1 }),
    // Odd justa = 100 / probabilidade (pp). Sem probabilidade não há odd justa.
    fairOdd: pp > 0 ? formatOdd(100 / pp) : "—",
  };
}

export function toMatchModelReadingView(
  snapshot: MatchModelSnapshot,
  now: Date,
): MatchModelReadingView {
  const p = snapshot.probabilities;
  const mr = getMarketPresentation("match_result");
  const dc = getMarketPresentation("double_chance");
  const btts = getMarketPresentation("btts");
  const ou = getMarketPresentation("over_under");

  const markets: MatchModelReadingView["markets"] = [
    {
      key: "match_result",
      label: mr.marketLabel,
      selections: (["home", "draw", "away"] as const).map((k) =>
        selection(mr.outcomeLabel(k, null), p.match_result[k]),
      ),
    },
    {
      key: "double_chance",
      label: dc.marketLabel,
      selections: (["home_or_draw", "away_or_draw", "home_or_away"] as const).map(
        (k) => selection(dc.outcomeLabel(k, null), p.double_chance[k]),
      ),
    },
    {
      key: "btts",
      label: btts.marketLabel,
      selections: (["yes", "no"] as const).map((k) =>
        selection(btts.outcomeLabel(k, null), p.btts[k]),
      ),
    },
    ...([1.5, 2.5, 3.5] as const).map((line) => ({
      key: `over_under:${line}`,
      label: `${ou.marketLabel} · ${line}`,
      selections: (["over", "under"] as const).map((k) =>
        selection(ou.outcomeLabel(k, line), p.over_under[`${line}`][k]),
      ),
    })),
  ];

  return {
    markets,
    topScorelines: snapshot.topScorelines.map((s) => ({
      score: `${s.home}–${s.away}`,
      pct: formatPct(s.pct, { decimals: 1 }),
    })),
    source: sourceLabel(snapshot),
    jev:
      snapshot.jevStatus === "applied"
        ? "+ JEV"
        : snapshot.jevStatus === "failed"
          ? "JEV falhou"
          : null,
    computedAgo: formatRelativeAgoLabel(snapshot.checkedAt, now),
  };
}
