import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import type { OddsApiOutcome } from "@/lib/providers/odds-api-schemas";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/**
 * Descriptor local tipado de mercado (#164). NÃO é o registry do #165 — é o
 * mínimo necessário pra generalizar a ingestão de odds binária (over/under) para
 * N seleções, mantendo TRÊS vocabulários separados que historicamente colidiam:
 *
 *   - `providerMarketKey`: a chave do mercado no The Odds API (`'totals'` / `'h2h'`).
 *   - `dbMarketKey`: a chave em `markets.key` (`'over_under'` / `'match_result'`).
 *     NÃO confundir com o enum LEGADO `match_odds_snapshots.market = 'over_under_2_5'`
 *     (esse carrega a linha no sufixo; aqui a linha vive em `market_params.line`).
 *   - `dbSelectionKey`: a chave em `market_selections.key` (`'over'`/`'under'`,
 *     `'home'`/`'draw'`/`'away'`).
 *
 * A linha (2.5, 3.5, …) é SEMPRE `params.line` — nunca um sufixo de key. Cada
 * descriptor sabe mapear um `ProviderOutcome` cru → `dbSelectionKey` e qual é o
 * conjunto canônico de seleções (usado pra validar "mercado completo": um book só
 * é elegível se oferece TODAS as `selectionKeys`).
 */
export type MarketDescriptor = {
  dbMarketKey: string;
  providerMarketKey: string;
  params?: { line: number };
  resolveSelectionKey(
    outcome: OddsApiOutcome,
    ctx: { homeTeam: string; awayTeam: string },
    params?: { line: number },
  ): string | null;
  selectionKeys: string[];
  // De onde as odds do provider vêm. `featured` (default, ausente): mercado do
  // batch `/odds` da liga (h2h/totals) — over_under/match_result. `additional`:
  // só pelo endpoint POR EVENTO `/events/{id}/odds` (btts/dupla chance) — NUNCA
  // batch (quota 500/mês). Dispatch em fetch-and-snapshot/predict é por ESTE
  // campo (data-driven), nunca por nome de mercado.
  oddsSource?: "featured" | "additional";
  // Allowlist de ligas com cobertura de odds validada (ADR 0015). `undefined` =
  // coberto em TODAS as ligas (over_under/match_result). Definido = mercado só é
  // ofertado/analisável nessas ligas (#158). Adicionar uma liga depois é 1 linha,
  // sem migration.
  coveredLeagues?: readonly SupportedLeague[];
};

/**
 * Casa o nome de um time vindo do provider contra o nome canônico do DB. Mesma
 * heurística usada no pareamento de eventos (normaliza + igualdade/inclusão
 * bidirecional) — definida AQUI como fonte única e reusada por
 * `fetch-and-snapshot.ts` pra não divergir.
 */
export function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// over/under 2.5 — o único mercado ATIVO em produção (markets.is_active=true,
// seedado na migration 0009). Linha fixa em 2.5; outcomes 'Over'/'Under' do
// provider mapeiam direto pra 'over'/'under', exigindo `point === params.line`.
export const OVER_UNDER: MarketDescriptor = {
  dbMarketKey: "over_under",
  providerMarketKey: "totals",
  params: { line: 2.5 },
  resolveSelectionKey(outcome, _ctx, params) {
    const line = params?.line ?? OVER_UNDER.params?.line;
    if (outcome.point !== line) return null;
    const name = outcome.name.toLowerCase();
    if (name === "over") return "over";
    if (name === "under") return "under";
    return null;
  },
  selectionKeys: ["over", "under"],
};

// 1X2 (match_result) — seedado ATIVO admin-only em produção (markets.is_active=true,
// is_graduated=false, migration 0014/#173): selecionável só por admin até graduar.
// 'Draw' → 'draw'; senão casa o nome do time contra home/away via `teamsMatch`
// (NÃO igualdade exata — o provider pode usar grafias divergentes).
export const MATCH_RESULT: MarketDescriptor = {
  dbMarketKey: "match_result",
  providerMarketKey: "h2h",
  resolveSelectionKey(outcome, ctx) {
    if (outcome.name.toLowerCase() === "draw") return "draw";
    if (teamsMatch(outcome.name, ctx.homeTeam)) return "home";
    if (teamsMatch(outcome.name, ctx.awayTeam)) return "away";
    return null;
  },
  selectionKeys: ["home", "draw", "away"],
};

// BTTS (ambas marcam) — mercado binário (yes/no, N=2, SEM linha, SEM push).
// Odds *additional*: só por evento (`oddsSource: 'additional'`). Cobertura
// validada na Copa (2026-06-12, #158); restrito a world_cup até re-checar o
// Brasileirão. Outcomes 'Yes'/'No' do provider → 'yes'/'no' (sem `point`).
export const BTTS: MarketDescriptor = {
  dbMarketKey: "btts",
  providerMarketKey: "btts",
  oddsSource: "additional",
  coveredLeagues: ["world_cup"],
  resolveSelectionKey(outcome) {
    const name = outcome.name.toLowerCase();
    if (name === "yes") return "yes";
    if (name === "no") return "no";
    return null;
  },
  selectionKeys: ["yes", "no"],
};

// Lista canônica de descriptors p/ índices data-driven (ex.: marketsForLeague
// indexa por dbMarketKey). Um mercado novo entra aqui + no registry do cartucho.
export const ALL_DESCRIPTORS: readonly MarketDescriptor[] = [
  OVER_UNDER,
  MATCH_RESULT,
  BTTS,
];
