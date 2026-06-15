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
 *     A linha vive em `market_params.line`, nunca num sufixo de key (o enum/tabela
 *     legados over_under_2_5 / match_odds_snapshots saíram na Fase 5).
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
  // Soma-alvo das probabilidades implícitas do mercado (ADR 0018 + emenda
  // não-partição). `undefined`/1 = mercado de PARTIÇÃO (seleções mutuamente
  // exclusivas — over/under, 1X2): Σ implied = 1 (100%), a normalização canônica.
  // >1 = mercado de COBERTURA SOBREPOSTA (dupla chance): cada seleção cobre k de
  // N resultados-base e elas se sobrepõem, então a prob REAL soma o nº de
  // coberturas (dupla chance: cada par cobre 2 de 3 → Σ = 2). A implícita por
  // seleção é de-vigada mantendo a semântica de par escalando a normalização
  // Σ=1 por este fator; modelProb do LLM vem na MESMA escala (probs honestas
  // somando ~impliedSumTarget·100). Aplicado em DOIS sites (predict + view) — o
  // core computeMarketImpliedProbabilities fica Σ=1 (paridade over/under/1X2).
  impliedSumTarget?: number;
  // Linhas candidatas que o cartucho avalia numa ÚNICA análise (over_under
  // multi-linha v3.0, #175: [1.5, 2.5, 3.5]). `undefined` = mercado de UMA linha
  // (params.line) — o caminho de hoje, byte-idêntico. Quando definido, predict
  // resolve um bundle POR linha, o cartucho vê todas e escolhe via `resolveParams`.
  // Só meias-linhas (inteiras dariam push — fora de escopo).
  candidateLines?: number[];
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

// over/under FEATURED, linha 2.5 (caminho padrão / flag-OFF, seedado na 0009).
// Sourcing featured ('totals', batch da liga). Linha 2.5 é o default; as linhas
// extras (1.5/3.5) vivem na variante OVER_UNDER_ALT (#175), NÃO aqui — este
// descriptor fica byte-idêntico (paridade flag-OFF). outcomes 'Over'/'Under' do
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

// Variante MULTI-LINHA do over/under (over_under_v3.0, #175). MESMA identidade de
// mercado que OVER_UNDER (dbMarketKey 'over_under', mesmas seleções, mesma
// resolveSelectionKey por `point === params.line`, partição Σ=1), mas:
//   - sourcing ADDITIONAL via 'alternate_totals' — a escada 1.5/2.5/3.5 só vem por
//     evento (/events/{id}/odds); o featured 'totals' NÃO a entrega (live-validado
//     2026-06-14: 3.5 ausente do featured; alternate traz a escada completa);
//   - candidateLines = as meias-linhas avaliadas numa análise;
//   - coveredLeagues ['world_cup']: cobertura de alternate_totals validada só na
//     Copa por ora (mesma disciplina de btts/dupla chance) — expandir = 1 linha.
// NÃO entra em ALL_DESCRIPTORS (mesma dbMarketKey de OVER_UNDER): getDescriptor e
// COVERED_LEAGUES_BY_MARKET continuam resolvendo a variante featured (a view lê
// impliedSumTarget do OVER_UNDER, idêntico). Referenciada SÓ pelo cartucho v3,
// selecionado por flag. resolveSelectionKey é herdada (spread) — usa params.line
// explícito por linha na resolução multi-bundle.
export const OVER_UNDER_ALT: MarketDescriptor = {
  ...OVER_UNDER,
  providerMarketKey: "alternate_totals",
  oddsSource: "additional",
  coveredLeagues: ["world_cup"],
  candidateLines: [1.5, 2.5, 3.5],
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

// Dupla chance (1X/X2/12) — mercado N=3 de COBERTURA SOBREPOSTA (cada dupla cobre
// 2 de 3 resultados → impliedSumTarget=2, ver emenda do ADR 0018). Odds *additional*
// (só por evento, oddsSource:'additional'), cobertura validada na Copa (2026-06-12,
// #158), restrito a world_cup até re-checar o Brasileirão. O provider nomeia os
// outcomes com nomes de time COMPOSTOS, em ordem livre: "{home} or Draw" /
// "{away} or Draw" / "{teamA} or {teamB}" (validado em payload real 1xBet eu).
// resolveSelectionKey faz parsing estrutural + casa via teamsMatch, com null
// defensivo em qualquer não-correspondência (book incompleto é dropado, nunca
// mal-mapeado). #176.
export const DOUBLE_CHANCE: MarketDescriptor = {
  dbMarketKey: "double_chance",
  providerMarketKey: "double_chance",
  oddsSource: "additional",
  coveredLeagues: ["world_cup"],
  impliedSumTarget: 2,
  resolveSelectionKey(outcome, ctx) {
    const parts = outcome.name.split(/\s+or\s+/i).map((p) => p.trim());
    if (parts.length !== 2) return null; // não adivinha nomes com " or " literal
    const isDraw = (p: string) => normalizeTeamName(p) === "draw";
    const [a, b] = parts;
    const drawA = isDraw(a);
    const drawB = isDraw(b);
    if (drawA && drawB) return null;
    if (drawA || drawB) {
      const team = drawA ? b : a;
      const homeHit = teamsMatch(team, ctx.homeTeam);
      const awayHit = teamsMatch(team, ctx.awayTeam);
      // EXATAMENTE um time casa. Defensivo contra nomes em que um normaliza pra
      // substring do outro (ex. "Korea"/"South Korea"): o includes() bidirecional
      // do teamsMatch casaria AMBOS → ambíguo → null (nunca mapeia o par errado).
      if (homeHit && !awayHit) return "home_or_draw";
      if (awayHit && !homeHit) return "away_or_draw";
      return null;
    }
    // Dois times (sem Draw) → 12; exige casar AMBOS home E away (ordem livre).
    const homeAway =
      teamsMatch(a, ctx.homeTeam) && teamsMatch(b, ctx.awayTeam);
    const awayHome =
      teamsMatch(a, ctx.awayTeam) && teamsMatch(b, ctx.homeTeam);
    return homeAway || awayHome ? "home_or_away" : null;
  },
  selectionKeys: ["home_or_draw", "away_or_draw", "home_or_away"],
};

// Lista canônica de descriptors p/ índices data-driven (ex.: marketsForLeague
// indexa por dbMarketKey). Um mercado novo entra aqui + no registry do cartucho.
export const ALL_DESCRIPTORS: readonly MarketDescriptor[] = [
  OVER_UNDER,
  MATCH_RESULT,
  BTTS,
  DOUBLE_CHANCE,
];

// Lookup por dbMarketKey (data-driven). Usado pela view (toAnalysisView) pra ler
// `impliedSumTarget` sem hardcodear mercado — fonte única é o descriptor.
export function getDescriptor(
  dbMarketKey: string,
): MarketDescriptor | undefined {
  return ALL_DESCRIPTORS.find((d) => d.dbMarketKey === dbMarketKey);
}
