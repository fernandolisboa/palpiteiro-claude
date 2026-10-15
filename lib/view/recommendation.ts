import { formatLine } from "@/lib/format-number";
import { findDisplayPresentation } from "@/lib/view/markets/display";
import type { TeamLabels } from "@/lib/view/markets/with-team-labels";
import type { Recommendation } from "@/lib/view/types";

/** Rótulo de tela de "pass" (ADR 0056): o motor diz PASS, a tela diz "Sem aposta". */
export const PASS_LABEL = "Sem aposta";

/**
 * Tipo da recomendação, derivado do valor CRU (`predictions.recommendation`), nunca do
 * rótulo: a cor na tabela do desempenho e no feed de recentes lê daqui, então trocar
 * o texto de tela não quebra a cor em silêncio.
 */
export type RecommendationKind = "over" | "under" | "pass" | "other";

export function recommendationKind(recommendation: string): RecommendationKind {
  return recommendation === "over" || recommendation === "under" || recommendation === "pass"
    ? recommendation
    : "other";
}

/**
 * Display da recomendação pra QUALQUER mercado (#173, #539, ADR 0056), compartilhado
 * pela tabela/detalhe do dashboard e pelo feed de análises recentes:
 *  1. pass → "Sem aposta";
 *  2. seleção com rótulo na apresentação de tela → ele (over com a linha → "Mais de
 *     2,5"; "home" → "Casa", ou o nome do time quando `teams` vem; "yes" → "Sim");
 *  3. senão o `market_selections.label` do DB (artilheiro/assistência: nome do
 *     jogador, materializado no predict — a apresentação só conhece a key);
 *  4. em último caso a key crua (row degradada, sem seleção).
 * Não lança pra mercado sem apresentação: o feed de recentes roda na home, e um
 * mercado novo sem entry no REGISTRY não pode derrubar /jogos.
 */
export function recommendationLabel(
  recommendation: string,
  marketKey: string,
  selectionLabel: string | null = null,
  // Nome (ou sigla) dos times no 1X2/dupla chance (#574): "Palmeiras" em vez de "Casa".
  teams?: TeamLabels,
  // Linha do mercado (over/under): entra no rótulo ("Mais de 2,5"). null → linha padrão.
  line: number | null = null,
): Recommendation {
  if (recommendation === "pass") return PASS_LABEL;
  const presentation = findDisplayPresentation(marketKey, teams);
  // Sem linha gravada (row legada), cai na linha padrão do mercado (over/under: 2,5).
  const fromPresentation = presentation?.outcomeLabel(
    recommendation,
    line ?? presentation.defaultLine,
  );
  if (fromPresentation !== undefined && fromPresentation !== recommendation) {
    return fromPresentation;
  }
  return selectionLabel ?? recommendation;
}

/**
 * Contexto do mercado ao lado da recomendação ("Ambas marcam", "Total de gols"): sem
 * ele, "Sim" sozinho não diz qual aposta foi. Quando a linha já está no rótulo da
 * recomendação ("Mais de 2,5"), o contexto não a repete; em "Sem aposta" a linha fica
 * ("Total de gols 2,5").
 */
export function marketContextLabel(
  marketLabel: string,
  marketParams: { line: number } | null,
  recommendation?: string,
): string {
  const lineInRec = recommendation !== undefined && recommendation !== "pass";
  return marketParams && !lineInRec
    ? `${marketLabel} ${formatLine(marketParams.line)}`
    : marketLabel;
}
