import { formatLine } from "@/lib/format-number";
import {
  findMarketPresentation,
  getMarketPresentation,
  type MarketPresentation,
} from "@/lib/view/markets/presentation";
import { withTeamLabels, type TeamLabels } from "@/lib/view/markets/with-team-labels";

// Vocabulário de TELA (ADR 0056, linha 16 da revisão de design): "Total de gols ·
// Mais de 2,5" em vez de "Over/Under gols · Over 2.5". Embrulha a presentation do
// registry SEM mutá-la: `presentation.ts` espelha o seed e alimenta o texto do modelo
// (lib/ai/predict.ts, lib/ai/palpites/synthesis-input.ts), que continuam lendo
// `getMarketPresentation` direto. Nenhum arquivo de lib/ai importa este módulo.
// Mesma pureza de bundle do presentation.ts (sem @/lib/ai, @/lib/db,
// market-descriptor): a view-layer é alcançável por componentes "use client".

export const OVER_UNDER_SCREEN_LABEL = "Total de gols";

const OVER_UNDER_SIDE: Record<string, string> = {
  over: "Mais de",
  under: "Menos de",
};

/**
 * Presentation com os rótulos de tela. Só over/under muda: nome do mercado, seleção,
 * outcome ("Mais de 2,5"), coluna de cenário ("mais de 2,5 gols") e o nome da aposta
 * ("Mais de 2,5 gols"), todos com vírgula decimal. As frases leigas (`plain`,
 * `framingLabel`) e o resto passam direto.
 */
export function withScreenLabels(p: MarketPresentation): MarketPresentation {
  if (p.marketKey !== "over_under") return p;
  const side = (key: string): string | null => OVER_UNDER_SIDE[key] ?? null;
  return {
    ...p,
    marketLabel: OVER_UNDER_SCREEN_LABEL,
    selectionLabel: (key) => side(key) ?? p.selectionLabel(key),
    outcomeLabel: (key, line) => {
      const s = side(key);
      if (s === null) return p.outcomeLabel(key, line);
      return line !== null ? `${s} ${formatLine(line)}` : s;
    },
    scenarioLabel: (key, line) => {
      const s = side(key);
      if (s === null) return p.scenarioLabel(key, line);
      return `${s.toLowerCase()} ${formatLine(line ?? p.defaultLine ?? 2.5)} gols`;
    },
    betSummary: (key, line) => {
      const original = p.betSummary(key, line);
      const s = side(key);
      if (s === null) return original;
      return { ...original, market: `${s} ${formatLine(line ?? p.defaultLine ?? 2.5)} gols` };
    },
  };
}

/** Presentation de tela: rótulos em português + nome dos times (1X2, dupla chance). */
export function getDisplayPresentation(
  marketKey: string,
  teams?: TeamLabels,
): MarketPresentation {
  return withTeamLabels(withScreenLabels(getMarketPresentation(marketKey)), teams);
}

/** Variante que não lança: null pra mercado sem apresentação. */
export function findDisplayPresentation(
  marketKey: string,
  teams?: TeamLabels,
): MarketPresentation | null {
  const p = findMarketPresentation(marketKey);
  return p ? withTeamLabels(withScreenLabels(p), teams) : null;
}

/**
 * Rótulo de mercado que vem do banco (`markets.label`, ex.: "Over/Under gols") na
 * tela: over/under vira "Total de gols"; o resto fica como veio.
 */
export function displayMarketLabel(marketKey: string, fallback: string): string {
  return marketKey === "over_under" ? OVER_UNDER_SCREEN_LABEL : fallback;
}

/**
 * Categoria canônica (saída do normalizador de /p, `public-category.ts`) na tela: só o
 * over/under muda ("Over/Under gols" → "Total de gols"). Aplicado DEPOIS do
 * normalizador; o rótulo de tela não tem dígito, então nenhuma linha vaza.
 */
export function displayCategoryLabel(canonical: string): string {
  return canonical === getMarketPresentation("over_under").marketLabel
    ? OVER_UNDER_SCREEN_LABEL
    : canonical;
}
