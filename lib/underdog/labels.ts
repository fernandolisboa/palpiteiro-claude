import { newsFactorPhraseFor } from "@/lib/match-news/labels";

import type {
  FormResult,
  JevSignalFactor,
  UnderdogScenarioId,
  UnderdogSignal,
} from "./types";

// Frases do painel do azarão (#671) montadas pelo código: a mesma etiqueta vai à tela
// (lib/view/underdog.ts) e ao bloco de fatos da IA (facts.ts), pra o texto e a tela
// falarem a mesma língua. Tom de mesa de amigos (ADR 0070), sem artigo antes do nome
// do time (o gênero varia).

export type UnderdogNames = { underdog: string; favorite: string };

const FORM_LETTER: Record<FormResult, string> = { W: "V", D: "E", L: "D" };

export function formLetters(results: FormResult[]): string {
  return results.map((r) => FORM_LETTER[r]).join(" ");
}

export function scenarioLabel(
  id: UnderdogScenarioId,
  n: UnderdogNames,
  sep: "×" | "x" = "×"
): string {
  switch (id) {
    case "lead_30":
      return `Se ${n.underdog} estiver vencendo por 1 ${sep} 0 aos 30'`;
    case "red_60":
      return `Se ${n.favorite} ficar com um a menos desde os 60'`;
    case "absences_max":
      return `${n.favorite} desfalcado e com rodízio (máximo que o modelo aplica)`;
  }
}

const JEV_LABEL: Record<JevSignalFactor, (n: UnderdogNames) => string> = {
  attack_weakened: (n) => `${n.favorite} com o ataque desfalcado, pelo JEV`,
  defense_weakened: (n) => `${n.favorite} com a defesa desfalcada, pelo JEV`,
  rotation_risk: (n) => `${n.favorite} pode poupar titulares, pelo JEV`,
  high_stakes: (n) => `Jogo que vale muito pra ${n.underdog}, pelo JEV`,
};

export function signalLabel(s: UnderdogSignal, n: UnderdogNames): string {
  switch (s.kind) {
    case "h2h":
      return `${n.underdog} venceu ${s.underdogWins} dos últimos ${s.games} confrontos`;
    case "form":
      return `Forma: ${n.underdog} ${formLetters(s.underdog)} · ${n.favorite} ${formLetters(s.favorite)}`;
    case "absences":
      return `${n.favorite} com ${s.favorite} na lista de desfalques`;
    case "jev":
      return JEV_LABEL[s.factor](n);
    case "news":
      return newsSignalLabel(s, n);
  }
}

/**
 * Rótulo do sinal de notícia: a frase do código e "segundo o ge", com "(não conferido)"
 * quando os nossos dados não confirmam (como no narrador e na síntese). `extra` entra no
 * mesmo parêntese (o template do azarão acrescenta "já está na chance").
 */
export function newsSignalLabel(
  s: Extract<UnderdogSignal, { kind: "news" }>,
  n: UnderdogNames,
  extra: readonly string[] = []
): string {
  const phrase = newsFactorPhraseFor(
    s.factor,
    s.factor === "high_stakes" ? n.underdog : n.favorite
  );
  const notes = [...(s.strength === "unverified" ? ["não conferido"] : []), ...extra];
  return `${phrase}, segundo o ge${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

export type SignalOrigin = "dados" | "modelo" | "notícia";

export const signalOrigin = (s: UnderdogSignal): SignalOrigin =>
  s.kind === "jev" ? "modelo" : s.kind === "news" ? "notícia" : "dados";

/**
 * A linha do sinal de notícia no bloco de fatos da IA (#672): só a frase do código, com a
 * conferência, NUNCA o título da matéria (texto de terceiro não vai ao advogado).
 */
export function newsSignalFactLine(
  s: Extract<UnderdogSignal, { kind: "news" }>,
  n: UnderdogNames
): string {
  const check =
    s.strength === "confirmed" ? "confirmado pelos nossos dados" : "não conferido";
  const phrase = newsFactorPhraseFor(
    s.factor,
    s.factor === "high_stakes" ? n.underdog : n.favorite
  );
  return `Segundo o ge, ${check}: ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
}

/** "1 jogo em cada N": só entre 5% e 50%, senão o arredondamento engana. */
export function oneInN(pct: number): number | null {
  if (!Number.isFinite(pct) || pct < 5 || pct > 50) return null;
  return Math.round(100 / pct);
}
