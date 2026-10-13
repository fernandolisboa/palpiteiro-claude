import type { BetLegParams } from "@/db/schema";

// Catálogo PURO dos mercados do cupom (Fase 2, #556): o que a grade oferece e como
// cada perna se liga ao mercado de odds de referência (pra edge contra o mercado
// de-vigado). Sem DB/IO — roda na page (montagem da grade) e na action (avaliação).

// Kinds que a grade oferece. Todos são predicados do placar final, então a matriz do
// modelo precifica qualquer um, em qualquer liga, sem LLM.
export type SlipGridKind =
  | "match_result"
  | "double_chance"
  | "btts"
  | "over_under"
  | "exact_score";

export const SLIP_TOTAL_LINES = [1.5, 2.5, 3.5] as const;

// Teto de pernas do cupom: em "Simples" cada perna vira uma aposta (um slip de 1
// perna); em "Combinada" vale o MAX_LEGS do contrato do slip (4).
export const MAX_SLIP_SELECTIONS = 8;

// Ponte perna → mercado da tabela de odds. As chaves das seleções batem com as da
// perna, exceto dupla chance (perna home_draw ↔ mercado home_or_draw etc.).
export const DOUBLE_CHANCE_MARKET_KEY: Record<string, string> = {
  home_draw: "home_or_draw",
  home_away: "home_or_away",
  draw_away: "away_or_draw",
};

export type MarketPin = {
  dbMarketKey: "match_result" | "double_chance" | "btts" | "over_under";
  selectionKey: string;
  line: number | null;
};

/**
 * Mercado de referência da perna, ou null quando a perna não tem mercado de odds que a
 * gente capture (placar exato, 1º tempo, props, cartões, escanteios).
 */
export function legMarketPin(kind: string, params: BetLegParams): MarketPin | null {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "match_result":
      return { dbMarketKey: "match_result", selectionKey: String(p.selection), line: null };
    case "btts":
      return { dbMarketKey: "btts", selectionKey: String(p.selection), line: null };
    case "double_chance": {
      const key = DOUBLE_CHANCE_MARKET_KEY[String(p.selection)];
      return key ? { dbMarketKey: "double_chance", selectionKey: key, line: null } : null;
    }
    case "over_under":
      return {
        dbMarketKey: "over_under",
        selectionKey: String(p.selection),
        line: Number(p.line),
      };
    default:
      return null;
  }
}

/** Chave estável do grupo de mercado da perna (mercado + linha): uma seleção por grupo. */
export function legGroupKey(kind: string, params: BetLegParams): string {
  const p = params as Record<string, unknown>;
  if (kind === "over_under") return `over_under:${p.line}`;
  if (kind === "exact_score") return "exact_score";
  return kind;
}

/** Chave estável da seleção (botão da grade ↔ perna do cupom). */
export function legSelectionId(kind: string, params: BetLegParams): string {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "exact_score":
      return `exact_score:${p.home}-${p.away}`;
    case "over_under":
      return `over_under:${p.line}:${p.selection}`;
    case "margin":
      return `margin:${p.side}:${p.minMargin}`;
    case "clean_sheet":
      return `clean_sheet:${p.side}`;
    case "first_half_score":
      return `first_half_score:${p.home}-${p.away}`;
    case "first_half_over_under":
    case "cards":
    case "corners":
      return `${kind}:${p.line}:${p.selection}`;
    case "first_to_score":
      return `first_to_score:${p.firstToScore}`;
    default:
      return `${kind}:${String(p.selection)}`;
  }
}

/** Chave do mercado de referência: "match_result", "over_under:2.5"… */
export function referenceKey(pin: Pick<MarketPin, "dbMarketKey" | "line">): string {
  return pin.line === null ? pin.dbMarketKey : `${pin.dbMarketKey}:${pin.line}`;
}

// Seleções da grade por grupo, na ordem de exibição. Labels com nome de time ficam
// na view (lib/view/bet-slip.ts); aqui só a estrutura.
export type GridSelectionDef = { kind: SlipGridKind; params: BetLegParams };

export const GRID_FIXED_GROUPS: ReadonlyArray<{
  key: string;
  selections: GridSelectionDef[];
}> = [
  {
    key: "match_result",
    selections: (["home", "draw", "away"] as const).map((selection) => ({
      kind: "match_result" as const,
      params: { selection },
    })),
  },
  {
    key: "double_chance",
    selections: (["home_draw", "home_away", "draw_away"] as const).map(
      (selection) => ({ kind: "double_chance" as const, params: { selection } }),
    ),
  },
  {
    key: "btts",
    selections: (["yes", "no"] as const).map((selection) => ({
      kind: "btts" as const,
      params: { selection },
    })),
  },
  ...SLIP_TOTAL_LINES.map((line) => ({
    key: `over_under:${line}`,
    selections: (["over", "under"] as const).map((selection) => ({
      kind: "over_under" as const,
      params: { selection, line },
    })),
  })),
];

// Placares mais prováveis mostrados como botões; o resto entra por "outro placar".
export const TOP_EXACT_SCORES = 6;
export const MAX_EXACT_SCORE_GOALS = 9;
