// Linguagem de DISPLAY por mercado, keyed por `marketKey` — a fonte única das
// strings que a camada de view renderiza para cada mercado. PURO e SEGURO PRO
// BUNDLE DO CLIENTE: este módulo NÃO importa `@/lib/ai*` (carrega o SYSTEM_PROMPT,
// admin-only — ver o comentário de MIN_EDGE_PP em lib/odds/scenario.ts), nem
// `@/lib/db`, nem `lib/odds/market-descriptor` (arrasta os schemas de provider).
// A view-layer (alcançável por componentes "use client") consome este módulo, então
// a pureza aqui é inegociável e está pinada por teste (presentation.test.ts).
//
// Divisão de fontes (resolução do plan-gate do #169):
//   - LABELS CURTOS (selectionLabel/marketLabel): a fonte de verdade é o SEED
//     (`markets.label` / `market_selections.label`, migration 0009). Os valores
//     aqui ESPELHAM o seed e `presentation-seed-parity.pglite.test.ts` pina o
//     over/under contra o banco (anti-drift = honra o "(seed)" do issue).
//   - FRASE LEIGA (betSummary/framingLabel): o seed NÃO carrega — vive só aqui,
//     copiada VERBATIM do analysis.ts pré-pivot pra over/under ficar paridade.
//
// over/under e match_result (1X2) são ambos seedados ativos em produção (migration
// 0009 e 0014); match_result é admin-only (is_graduated=false) até graduar. Os
// labels CURTOS aqui ESPELHAM o seed (markets.label / market_selections.label) —
// a paridade over/under é pinada por presentation-seed-parity.pglite.test.ts.

export type BetSummaryCopy = {
  // Nome do mercado em linguagem clara ("Mais de 2.5 gols").
  market: string;
  // Tradução literal do que precisa acontecer ("pelo menos 3 gols no jogo").
  plain: string;
};

export type MarketPresentation = {
  marketKey: string;
  // Espelha markets.label (seed).
  marketLabel: string;
  // Linha default do mercado (over/under: 2.5; mercados sem linha: null). Usada
  // como fallback quando o chamador não passa a linha — evita um literal de
  // mercado no mapper (que lê daqui).
  defaultLine: number | null;
  // Label curto da seleção, espelha market_selections.label (seed). Fallback pra
  // própria key em seleção desconhecida (defensivo).
  selectionLabel: (selectionKey: string) => string;
  // Label do outcome composto com a linha: "Over" + 2.5 → "Over 2.5"; sem linha
  // (ex.: 1X2) → só o label da seleção ("Casa").
  outcomeLabel: (selectionKey: string, line: number | null) => string;
  // Rótulo LEIGO da COLUNA de cenário ("mais de 2.5 gols"/"menos de 2.5 gols" —
  // over/under; "Casa"/"Empate"/"Fora" — 1X2). Distinto de outcomeLabel ("Over
  // 2.5"): preserva a frase exibida hoje no header da coluna (paridade VISUAL).
  // Como betSummary/framingLabel, é frase leiga code-only (NÃO está no seed).
  scenarioLabel: (selectionKey: string, line: number | null) => string;
  // Frase leiga da aposta recomendada (o seed não carrega). null-safe via fallback.
  betSummary: (selectionKey: string, line: number | null) => BetSummaryCopy;
  // Label do lado na frase de framing do break-even ("pelo menos 3 gols").
  framingLabel: (selectionKey: string, line: number | null) => string;
  // Label da métrica de settlement no drill-down do dashboard ("gols (90')").
  settlementMetricLabel: string;
  // Classifica os gols de um confronto numa key de seleção pra lente de H2H, ou
  // `null` quando o mercado não é baseado em gols (a view degrada pra neutro).
  classifyH2H:
    | ((homeGoals: number, awayGoals: number, line: number | null) => string)
    | null;
};

function lookup(
  table: Record<string, string>,
  key: string,
  fallback: string,
): string {
  return key in table ? table[key] : fallback;
}

const OVER_UNDER_SELECTION_LABELS: Record<string, string> = {
  over: "Over",
  under: "Under",
};

// Frase leiga por lado — VERBATIM do BET_SUMMARY pré-pivot (analysis.ts). A linha
// "2.5"/"3 gols" fica embutida no texto de propósito (não recalcular de `line`):
// over/under só tem a linha 2.5 ativa, e recompor introduziria bug de refator
// sem ganho. Linhas extras (1.5/3.5) são trabalho futuro (#175).
const OVER_UNDER_BET_SUMMARY: Record<string, BetSummaryCopy> = {
  over: { market: "Mais de 2.5 gols", plain: "pelo menos 3 gols no jogo" },
  under: { market: "Menos de 2.5 gols", plain: "no máximo 2 gols no jogo" },
};

// VERBATIM do FRAMING_SIDE_LABEL pré-pivot.
const OVER_UNDER_FRAMING_LABELS: Record<string, string> = {
  over: "pelo menos 3 gols",
  under: "menos de 3 gols",
};

// Header de COLUNA do bloco de cenários — VERBATIM do SIDE_LABEL pré-pivot
// (analysis-scenarios.tsx). A linha "2.5" fica embutida de propósito (paridade
// com a string pinada nos goldens); recompor de `line` é trabalho futuro (#175).
const OVER_UNDER_SCENARIO_LABELS: Record<string, string> = {
  over: "mais de 2.5 gols",
  under: "menos de 2.5 gols",
};

const OVER_UNDER: MarketPresentation = {
  marketKey: "over_under",
  marketLabel: "Over/Under gols",
  defaultLine: 2.5,
  selectionLabel: (key) => lookup(OVER_UNDER_SELECTION_LABELS, key, key),
  outcomeLabel: (key, line) => {
    const base = lookup(OVER_UNDER_SELECTION_LABELS, key, key);
    return line !== null ? `${base} ${line}` : base;
  },
  scenarioLabel: (key) =>
    lookup(
      OVER_UNDER_SCENARIO_LABELS,
      key,
      lookup(OVER_UNDER_SELECTION_LABELS, key, key),
    ),
  betSummary: (key) =>
    key in OVER_UNDER_BET_SUMMARY
      ? OVER_UNDER_BET_SUMMARY[key]
      : { market: lookup(OVER_UNDER_SELECTION_LABELS, key, key), plain: "" },
  framingLabel: (key) =>
    lookup(OVER_UNDER_FRAMING_LABELS, key, lookup(OVER_UNDER_SELECTION_LABELS, key, key)),
  settlementMetricLabel: "gols (90')",
  // Cut do over/under na linha 2.5: total de gols ESTRITAMENTE acima da linha é
  // "over". Em linha 2.5 (gols inteiros) total > 2.5 ⟺ total ≥ 3 — idêntico ao
  // corte legado de toH2HView, então a paridade é exata.
  classifyH2H: (homeGoals, awayGoals, line) =>
    homeGoals + awayGoals > (line ?? 2.5) ? "over" : "under",
};

// 1X2 (match_result) — seedado ativo admin-only (migration 0014/#173). Labels
// PT-BR ESPELHANDO o seed market_selections.label (Casa/Empate/Fora).
const MATCH_RESULT_SELECTION_LABELS: Record<string, string> = {
  home: "Casa",
  draw: "Empate",
  away: "Fora",
};

const MATCH_RESULT: MarketPresentation = {
  marketKey: "match_result",
  marketLabel: "Resultado (1X2)",
  defaultLine: null,
  selectionLabel: (key) => lookup(MATCH_RESULT_SELECTION_LABELS, key, key),
  outcomeLabel: (key) => lookup(MATCH_RESULT_SELECTION_LABELS, key, key),
  scenarioLabel: (key) => lookup(MATCH_RESULT_SELECTION_LABELS, key, key),
  betSummary: (key) => {
    const label = lookup(MATCH_RESULT_SELECTION_LABELS, key, key);
    return { market: label, plain: "" };
  },
  framingLabel: (key) => lookup(MATCH_RESULT_SELECTION_LABELS, key, key),
  settlementMetricLabel: "resultado (90')",
  // 1X2 não é mercado de gols — a lente over/under de H2H não se aplica.
  classifyH2H: null,
};

const REGISTRY: Record<string, MarketPresentation> = {
  [OVER_UNDER.marketKey]: OVER_UNDER,
  [MATCH_RESULT.marketKey]: MATCH_RESULT,
};

/**
 * Resolve a apresentação de um `marketKey`. LANÇA em chave desconhecida — um
 * mercado sem apresentação é bug de chamada, não algo a degradar (espelha
 * `getCartridge`). Roda em render server-side; nunca toca DB nem prompt.
 */
export function getMarketPresentation(marketKey: string): MarketPresentation {
  const presentation = REGISTRY[marketKey];
  if (!presentation) {
    throw new Error(`unknown market presentation: '${marketKey}'`);
  }
  return presentation;
}
