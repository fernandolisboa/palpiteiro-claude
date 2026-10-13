import { bootstrapMeanCi } from "@/lib/calibration/metrics";
import type { DevigMethod } from "@/lib/odds/implied-probability";

import type { BlendMarket } from "./blend";
import type { Odds1x2, OddsOverUnder } from "./matches";
import { devig1x2, devigOver, type EvaluatedMatch } from "./runner";

// Simulação de "aposta de valor" do jeito que a produção decide (report 13): por
// jogo e mercado, a seleção de maior edge (modelo − implícita de-vigada da MESMA
// casa) entra se o edge ≥ `minEdgePp`; 1 unidade na odd dessa casa. Mede o retorno
// pelo resultado (ROI) e pela linha de fechamento (CLV = odd × p_fechamento − 1,
// com o fechamento da Pinnacle de-vigado, senão o da média), que tem bem menos
// variância que o ROI e é o mesmo critério do gate de Kelly (ADR 0039 D3).

export type PriceSource = {
  odds1x2: (row: EvaluatedMatch) => Odds1x2 | null | undefined;
  oddsOu25: (row: EvaluatedMatch) => OddsOverUnder | null | undefined;
};

export type ValueBetSummary = {
  bets: number;
  roi: number; // média do lucro por unidade
  roiCi: { lo: number; hi: number } | null;
  clv: number;
  clvCi: { lo: number; hi: number } | null;
  clvBets: number; // apostas com linha de fechamento disponível
};

type Pick = { odd: number; won: boolean; pClose: number | null };

const KEYS = ["home", "draw", "away"] as const;

function pick1x2(
  row: EvaluatedMatch,
  model: string,
  price: Odds1x2,
  method: DevigMethod,
  minEdgePp: number,
): Pick | null {
  const p = row.byStrategy[model]?.p1x2;
  if (!p) return null;
  const implied = devig1x2(price, method);
  let best: (typeof KEYS)[number] | null = null;
  let bestEdge = -Infinity;
  for (const k of KEYS) {
    const edge = (p[k] - implied[k]) * 100;
    if (edge > bestEdge) {
      bestEdge = edge;
      best = k;
    }
  }
  if (!best || bestEdge < minEdgePp) return null;
  const close = row.match.closingPinnacle ?? row.match.closingAvg;
  return {
    odd: price[best],
    won: row.outcome === best,
    pClose: close ? devig1x2(close)[best] : null,
  };
}

function pickOu25(
  row: EvaluatedMatch,
  model: string,
  price: OddsOverUnder,
  method: DevigMethod,
  minEdgePp: number,
): Pick | null {
  const p = row.byStrategy[model]?.pOver25;
  if (p === undefined) return null;
  const impliedOver = devigOver(price, method);
  const overEdge = (p - impliedOver) * 100;
  const underEdge = -overEdge;
  const side = overEdge >= underEdge ? "over" : "under";
  if (Math.max(overEdge, underEdge) < minEdgePp) return null;
  const close =
    row.match.closingOu25Pinnacle ?? row.match.closingOu25Avg ?? null;
  const pCloseOver = close ? devigOver(close) : null;
  return {
    odd: price[side],
    won: side === "over" ? row.over25 === 1 : row.over25 === 0,
    pClose:
      pCloseOver === null
        ? null
        : side === "over"
          ? pCloseOver
          : 1 - pCloseOver,
  };
}

export function simulateValueBets(
  rows: readonly EvaluatedMatch[],
  opts: {
    model: string;
    market: BlendMarket;
    price: PriceSource;
    method: DevigMethod;
    minEdgePp: number;
  },
): ValueBetSummary {
  const profits: number[] = [];
  const clvs: number[] = [];
  for (const row of rows) {
    let pick: Pick | null = null;
    if (opts.market === "1x2") {
      const price = opts.price.odds1x2(row);
      if (price)
        pick = pick1x2(row, opts.model, price, opts.method, opts.minEdgePp);
    } else {
      const price = opts.price.oddsOu25(row);
      if (price)
        pick = pickOu25(row, opts.model, price, opts.method, opts.minEdgePp);
    }
    if (!pick) continue;
    profits.push(pick.won ? pick.odd - 1 : -1);
    if (pick.pClose !== null) clvs.push(pick.odd * pick.pClose - 1);
  }
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  return {
    bets: profits.length,
    roi: mean(profits),
    roiCi: bootstrapMeanCi(profits),
    clv: mean(clvs),
    clvCi: bootstrapMeanCi(clvs),
    clvBets: clvs.length,
  };
}
