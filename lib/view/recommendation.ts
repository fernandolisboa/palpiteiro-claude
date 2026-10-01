import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { Recommendation } from "@/lib/view/types";

// Tokens pinados do over/under (paridade byte-idêntica). pass é market-agnóstico.
const PINNED_TOKENS: Record<string, Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

/**
 * Display da recomendação pra QUALQUER mercado (#173, #539), compartilhado pela
 * tabela/detalhe do dashboard e pelo feed de análises recentes:
 *  1. over/under/pass → token pinado ("OVER"/"UNDER"/"PASS");
 *  2. seleção com rótulo na apresentação → ele ("home" → "Casa", "yes" → "Sim");
 *  3. senão o `market_selections.label` do DB (artilheiro/assistência: nome do
 *     jogador, materializado no predict — a apresentação só conhece a key);
 *  4. em último caso a key crua (row degradada, sem seleção).
 */
export function recommendationLabel(
  recommendation: string,
  marketKey: string,
  selectionLabel: string | null = null
): Recommendation {
  if (recommendation in PINNED_TOKENS) return PINNED_TOKENS[recommendation];
  const fromPresentation =
    getMarketPresentation(marketKey).selectionLabel(recommendation);
  if (fromPresentation !== recommendation) return fromPresentation;
  return selectionLabel ?? recommendation;
}

/**
 * Contexto do mercado ao lado da recomendação ("Ambas marcam", "Over/Under gols
 * 3.5"): sem ele, "Sim" ou "OVER" sozinhos não dizem qual aposta foi.
 */
export function marketContextLabel(
  marketLabel: string,
  marketParams: { line: number } | null
): string {
  return marketParams ? `${marketLabel} ${marketParams.line}` : marketLabel;
}
