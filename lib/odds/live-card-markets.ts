import {
  MATCH_RESULT,
  OVER_UNDER,
  type MarketDescriptor,
} from "@/lib/odds/market-descriptor";

// Mercados que a match page pré-aquece (fetch+snapshot) no load pro card de odds
// AO VIVO N-vias (#173 PR-2): over/under 2.5 + 1X2. AMBOS são `featured`
// (batch da liga, NÃO additional/per-evento), então o custo é +1 crédito de liga
// por refresh stale (h2h é um market separado de totals na The Odds API). NUNCA
// incluir btts/double_chance aqui (additional = 1 crédito POR EVENTO no load —
// queima quota; world_cup-only). Pinado por live-card-markets.test.ts.
export const PAGE_LIVE_MARKETS: MarketDescriptor[] = [OVER_UNDER, MATCH_RESULT];
