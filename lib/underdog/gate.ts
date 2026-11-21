import { UNDERDOG_MATERIAL_DELTA_PP, UNDERDOG_MIN_GAP_PP } from "./constants";
import type { UnderdogChances, UnderdogSide } from "./types";

// Quem é o azarão e quando o teaser aparece (#671, ADR 0072 §2). Puro: a página e a
// action usam as MESMAS funções. Não confundir com `underdogSide` de
// lib/view/match-tags.ts (a etiqueta do /jogos, < 20%, ADR 0070 §7): as duas regras
// convivem, a etiqueta é mais restrita que o botão.

export type UnderdogPick = {
  side: UnderdogSide;
  // pp com 1 casa, do ponto de vista do azarão.
  chances: UnderdogChances;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
// Folga de ponto flutuante: 0,08 vira 7,999999… em pp.
const EPS = 1e-9;

/**
 * O lado menos provável quando a diferença entre as vitórias dos dois lados é de pelo
 * menos UNDERDOG_MIN_GAP_PP. O empate não entra na regra. Entrada em fração (0..1),
 * como `p1X2` da matriz refeita (nunca o `probabilities` arredondado da row).
 */
export function findUnderdog(p: {
  home: number;
  draw: number;
  away: number;
}): UnderdogPick | null {
  const values = [p.home, p.draw, p.away];
  if (!values.every((v) => Number.isFinite(v) && v >= 0)) return null;
  const gap = Math.abs(p.home - p.away) * 100;
  if (gap + EPS < UNDERDOG_MIN_GAP_PP || p.home === p.away) return null;
  const side: UnderdogSide = p.away < p.home ? "away" : "home";
  const underdog = side === "home" ? p.home : p.away;
  const favorite = side === "home" ? p.away : p.home;
  return {
    side,
    chances: {
      underdog: round1(underdog * 100),
      draw: round1(p.draw * 100),
      favorite: round1(favorite * 100),
    },
  };
}

/** O placar provável do palpite dá a vitória a `side`. Empate nunca. */
export function palpiteFavorsSide(
  score: { home: number; away: number },
  side: UnderdogSide
): boolean {
  return side === "home" ? score.home > score.away : score.away > score.home;
}

/**
 * O teaser (o botão que cobra) aparece: flag ligada, pré-jogo analisável, palpite da IA
 * na tela, nenhum run em andamento, azarão claro e o palpite não cravando a vitória do
 * próprio azarão (porta de coerência até o #668 decidir o palpite em código).
 */
export function underdogTeaserVisible(args: {
  flag: boolean;
  preMatch: boolean;
  heroPalpite: { probableScore: { home: number; away: number } } | null;
  runInFlight: boolean;
  pick: UnderdogPick | null;
}): boolean {
  const { flag, preMatch, heroPalpite, runInFlight, pick } = args;
  if (!flag || !preMatch || runInFlight || pick === null) return false;
  if (heroPalpite === null) return false;
  return !palpiteFavorsSide(heroPalpite.probableScore, pick.side);
}

/**
 * A row guardada vale como atual: mesmo lado e azarão, empate e favorito mudaram menos
 * que UNDERDOG_MATERIAL_DELTA_PP (ADR 0072 §9). Sem base atual válida → false.
 */
export function isMaterialSame(
  stored: { side: UnderdogSide; chances: UnderdogChances },
  current: UnderdogPick | null
): boolean {
  if (current === null || current.side !== stored.side) return false;
  const keys = ["underdog", "draw", "favorite"] as const;
  return keys.every(
    (k) =>
      Math.abs(stored.chances[k] - current.chances[k]) + EPS <
      UNDERDOG_MATERIAL_DELTA_PP
  );
}
