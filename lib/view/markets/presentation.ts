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

// Shape estrutural LOCAL do resultData (espelha lib/settlement/schemas.ts sem
// importar @/lib/db nem @/lib/settlement — pureza de bundle pinada por teste).
// scorers/assisters/eventsAvailable são ADITIVOS (#290), OPCIONAIS — rows
// partition seguem byte-idênticas.
type SettlementMetricResultData = {
  homeScore: number | null;
  awayScore: number | null;
  totalGoals: number;
  scorers?: { playerId: number | null; canonicalName: string }[];
  assisters?: { playerId: number | null; canonicalName: string }[];
  eventsAvailable?: boolean;
} | null;

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
  // Valor da métrica de settlement, derivado do resultData (registry-driven, sem
  // hardcode de totalGoals no dashboard). over/under → total de gols; 1X2 → placar
  // "2-1"; btts → "Sim"/"Não". `totalGoalsFallback` é só rede de segurança quando
  // o resultData não carrega o total; ausente nos dois → "—" (NUNCA fabrica 0 —
  // prefer skip over silent wrong settle). O dashboard NÃO lê mais a coluna legada
  // total_goals (Fase 5): a fonte é o resultData jsonb.
  settlementMetricValue: (
    resultData: SettlementMetricResultData,
    totalGoalsFallback: number | null,
  ) => string;
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

// Total de gols pra métrica de settlement: o resultData jsonb é a fonte, o
// fallback é a rede de segurança histórica. Ausente nos dois → "—", NUNCA "0"
// (não fabrica resultado — prefer skip over silent wrong settle).
function totalOrDash(
  rd: SettlementMetricResultData,
  fallback: number | null,
): string {
  const total = rd?.totalGoals ?? fallback;
  return total != null ? String(total) : "—";
}

const OVER_UNDER_SELECTION_LABELS: Record<string, string> = {
  over: "Over",
  under: "Under",
};

// Frase leiga over/under DIRIGIDA PELA LINHA (#175). Pré-pivot a linha "2.5"/"3
// gols" ficava embutida nos textos; agora a VIEW threada `line` (analysis.ts
// passa marketParams.line a estas closures), então uma predição em 1.5/3.5
// renderiza a linha certa em vez de "2.5" hardcoded. Convenção (espelha o
// `${base} ${line}` de outcomeLabel):
//   - A linha exibida é `${line}` (ex.: "mais de 1.5 gols", "Menos de 3.5 gols").
//   - "pelo menos N gols" (lado over) usa Math.ceil(line): 1.5→2, 2.5→3, 3.5→4.
//   - "no máximo N gols" (plain do under) usa Math.ceil(line) − 1: 1.5→1, 2.5→2,
//     3.5→3 (o complemento inteiro do over).
//   - "menos de N gols" (framing do under) usa Math.ceil(line): 1.5→2, 2.5→3.
// PINADO em line=2.5 byte-idêntico ao texto pré-pivot pelos goldens existentes.
// Pluralização PT-BR de contagem INTEIRA de gols: "1 gol" vs "N gols". Só afeta a
// contagem singular (linha 1.5 under → "no máximo 1 gol"); em 2.5 as contagens são
// 2/3 → "gols", byte-idêntico ao texto pré-pivot. Os labels DECIMAIS ("1.5 gols",
// "mais de 2.5 gols") são sempre plural em PT-BR e não passam por aqui.
function golsCount(n: number): string {
  return n === 1 ? `${n} gol` : `${n} gols`;
}

function overUnderBetSummary(key: string, line: number): BetSummaryCopy {
  const atLeast = Math.ceil(line);
  if (key === "over") {
    return {
      market: `Mais de ${line} gols`,
      plain: `pelo menos ${golsCount(atLeast)} no jogo`,
    };
  }
  if (key === "under") {
    return {
      market: `Menos de ${line} gols`,
      plain: `no máximo ${golsCount(atLeast - 1)} no jogo`,
    };
  }
  return { market: lookup(OVER_UNDER_SELECTION_LABELS, key, key), plain: "" };
}

// Label do lado na frase de framing do break-even — DIRIGIDO PELA LINHA (#175).
// "pelo menos N gols"/"menos de N gols" com N = Math.ceil(line) (pluralizado).
function overUnderFramingLabel(key: string, line: number): string {
  const goals = Math.ceil(line);
  if (key === "over") return `pelo menos ${golsCount(goals)}`;
  if (key === "under") return `menos de ${golsCount(goals)}`;
  return lookup(OVER_UNDER_SELECTION_LABELS, key, key);
}

// Header de COLUNA do bloco de cenários — DIRIGIDO PELA LINHA (#175). Mostra
// `${line}` direto (decimal): "mais de 2.5 gols"/"menos de 2.5 gols".
function overUnderScenarioLabel(key: string, line: number): string {
  if (key === "over") return `mais de ${line} gols`;
  if (key === "under") return `menos de ${line} gols`;
  return lookup(OVER_UNDER_SELECTION_LABELS, key, key);
}

const OVER_UNDER: MarketPresentation = {
  marketKey: "over_under",
  marketLabel: "Over/Under gols",
  defaultLine: 2.5,
  selectionLabel: (key) => lookup(OVER_UNDER_SELECTION_LABELS, key, key),
  outcomeLabel: (key, line) => {
    const base = lookup(OVER_UNDER_SELECTION_LABELS, key, key);
    return line !== null ? `${base} ${line}` : base;
  },
  // line null (defensivo, ex.: row degradada) cai pro defaultLine 2.5 — preserva
  // a frase pré-pivot quando o chamador não threada a linha.
  scenarioLabel: (key, line) => overUnderScenarioLabel(key, line ?? 2.5),
  betSummary: (key, line) => overUnderBetSummary(key, line ?? 2.5),
  framingLabel: (key, line) => overUnderFramingLabel(key, line ?? 2.5),
  settlementMetricLabel: "gols (90')",
  // Total de gols (do resultData jsonb; "—" se ausente) — byte-idêntico ao legado
  // pra toda row liquidada com resultData (caso universal pós-backfill #162).
  settlementMetricValue: (rd, fallback) => totalOrDash(rd, fallback),
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
  // Placar de 90' ("2-1"); split nulo (histórica degradada) → total de gols ("—"
  // se também ausente).
  settlementMetricValue: (rd, fallback) =>
    rd && rd.homeScore !== null && rd.awayScore !== null
      ? `${rd.homeScore}-${rd.awayScore}`
      : totalOrDash(rd, fallback),
  // 1X2 não é mercado de gols — a lente over/under de H2H não se aplica.
  classifyH2H: null,
};

// btts (ambas marcam) — seedado ativo admin-only (#174). Labels CURTOS espelham
// o seed (markets.label "Ambas marcam" / market_selections.label "Sim"/"Não"),
// pinados por presentation-seed-parity.pglite.test.ts. betSummary/framingLabel são
// frase leiga code-only (não estão no seed). Renderiza pelo caminho N-vias (N=2).
const BTTS_SELECTION_LABELS: Record<string, string> = {
  yes: "Sim",
  no: "Não",
};

const BTTS_BET_SUMMARY: Record<string, BetSummaryCopy> = {
  yes: { market: "Ambos os times marcam", plain: "os dois times marcam no jogo" },
  no: {
    market: "Pelo menos um time não marca",
    plain: "ao menos um time termina sem marcar",
  },
};

const BTTS: MarketPresentation = {
  marketKey: "btts",
  marketLabel: "Ambas marcam",
  defaultLine: null,
  selectionLabel: (key) => lookup(BTTS_SELECTION_LABELS, key, key),
  outcomeLabel: (key) => lookup(BTTS_SELECTION_LABELS, key, key),
  scenarioLabel: (key) => lookup(BTTS_SELECTION_LABELS, key, key),
  betSummary: (key) =>
    key in BTTS_BET_SUMMARY
      ? BTTS_BET_SUMMARY[key]
      : { market: lookup(BTTS_SELECTION_LABELS, key, key), plain: "" },
  framingLabel: (key) => lookup(BTTS_SELECTION_LABELS, key, key),
  settlementMetricLabel: "ambas marcam (90')",
  // "Sim"/"Não" a partir do split de 90'; split nulo → "—" (nunca fabrica um
  // resultado — prefer skip over silent wrong settle). Ao vivo o split é sempre
  // populado, então rows settladas de btts sempre mostram Sim/Não.
  settlementMetricValue: (rd) =>
    rd && rd.homeScore !== null && rd.awayScore !== null
      ? rd.homeScore > 0 && rd.awayScore > 0
        ? "Sim"
        : "Não"
      : "—",
  // btts não é mercado de total de gols — a lente over/under de H2H não se aplica.
  classifyH2H: null,
};

// dupla chance (1X/X2/12) — seedado ativo admin-only (#176). Labels CURTOS
// espelham o seed (markets.label "Dupla chance" / market_selections.label
// "Casa ou empate"/"Empate ou fora"/"Casa ou fora"), pinados por
// presentation-seed-parity.pglite.test.ts. Renderiza pelo caminho N-vias (N=3,
// como o 1X2); a implícita exibida vem de-vigada em Σ=2 (impliedSumTarget).
const DOUBLE_CHANCE_SELECTION_LABELS: Record<string, string> = {
  home_or_draw: "Casa ou empate",
  away_or_draw: "Empate ou fora",
  home_or_away: "Casa ou fora",
};

const DOUBLE_CHANCE: MarketPresentation = {
  marketKey: "double_chance",
  marketLabel: "Dupla chance",
  defaultLine: null,
  selectionLabel: (key) => lookup(DOUBLE_CHANCE_SELECTION_LABELS, key, key),
  outcomeLabel: (key) => lookup(DOUBLE_CHANCE_SELECTION_LABELS, key, key),
  scenarioLabel: (key) => lookup(DOUBLE_CHANCE_SELECTION_LABELS, key, key),
  betSummary: (key) => {
    const label = lookup(DOUBLE_CHANCE_SELECTION_LABELS, key, key);
    return { market: label, plain: "" };
  },
  framingLabel: (key) => lookup(DOUBLE_CHANCE_SELECTION_LABELS, key, key),
  settlementMetricLabel: "resultado (90')",
  // Placar de 90' ("2-1"), como o 1X2 (o deriver só tem resultData, não a dupla);
  // split nulo (histórica degradada) → total de gols ("—" se também ausente).
  settlementMetricValue: (rd, fallback) =>
    rd && rd.homeScore !== null && rd.awayScore !== null
      ? `${rd.homeScore}-${rd.awayScore}`
      : totalOrDash(rd, fallback),
  // dupla chance não é mercado de total de gols — a lente over/under não se aplica.
  classifyH2H: null,
};

// correct_score (placar exato) — seedado ativo admin-only (#290). Os 16 labels
// CURTOS são derivados da própria key (cs_H_A → "H-A") em vez de um mapa literal
// (16 entradas), mas ESPELHAM byte-a-byte o seed market_selections.label
// ('0-0'..'3-3'), pinado por presentation-seed-parity.pglite.test.ts. Renderiza
// pelo caminho N-vias (N=16, partição); a implícita é normalizada Σ=1 sobre o grid.
const CORRECT_SCORE_KEY_RE = /^cs_(\d+)_(\d+)$/;

function correctScoreSelectionLabel(key: string): string {
  const m = key.match(CORRECT_SCORE_KEY_RE);
  return m ? `${m[1]}-${m[2]}` : key;
}

const CORRECT_SCORE: MarketPresentation = {
  marketKey: "correct_score",
  marketLabel: "Placar exato",
  defaultLine: null,
  selectionLabel: (key) => correctScoreSelectionLabel(key),
  outcomeLabel: (key) => correctScoreSelectionLabel(key),
  scenarioLabel: (key) => correctScoreSelectionLabel(key),
  betSummary: (key) => ({ market: correctScoreSelectionLabel(key), plain: "" }),
  framingLabel: (key) => correctScoreSelectionLabel(key),
  settlementMetricLabel: "placar (90')",
  // Placar de 90' ("2-1"), como o 1X2; split nulo (histórica degradada) → total
  // de gols ("—" se também ausente).
  settlementMetricValue: (rd, fallback) =>
    rd && rd.homeScore !== null && rd.awayScore !== null
      ? `${rd.homeScore}-${rd.awayScore}`
      : totalOrDash(rd, fallback),
  // placar exato não é mercado de total de gols — a lente over/under de H2H não se aplica.
  classifyH2H: null,
};

const REGISTRY: Record<string, MarketPresentation> = {
  [OVER_UNDER.marketKey]: OVER_UNDER,
  [MATCH_RESULT.marketKey]: MATCH_RESULT,
  [BTTS.marketKey]: BTTS,
  [DOUBLE_CHANCE.marketKey]: DOUBLE_CHANCE,
  [CORRECT_SCORE.marketKey]: CORRECT_SCORE,
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
