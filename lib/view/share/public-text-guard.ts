// Guard de RENDER do texto livre na superfície pública /p (ADR 0035 §2d / #438). Fonte
// ÚNICA pra página, metadata, imagem OG e títulos de fonte: odds/EV/edge/stake/%/R$ NUNCA
// saem no público. containsValueLanguage (denylist de 13 termos do guard de geração) NÃO
// basta — não bane "%" nem um preço/probabilidade solto ("2.10", "1,95") — então este guard
// é MAIS ESTRITO. Um falso-positivo (ex.: "1.5 gol por jogo") só degrada o texto; um
// falso-negativo publicaria um número de valor, que é o risco regulatório.

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

// Formas de preço/probabilidade que a denylist de valor não pega. Falso-positivo aqui
// (uma data "12/10", "3/4 dos jogos") só degrada o texto — preferível a vazar um número.
const PUBLIC_UNSAFE_PATTERNS: readonly RegExp[] = [
  /%/, // probabilidade: "62%"
  /\bpor\s*cento\b/i, // "60 por cento"
  /\d*[.,]\d/, // decimal: "2.10", "1,95", "1.955", ".95"
  /\d+\s*\/\s*\d+/, // odd fracionária: "5/2", "7 / 4"
  /\d+\s*(?:pra|para)\s*\d+/i, // "paga 3 pra 1"
  /@\s*\d/, // preço após arroba: "@3", "@ 2.10"
];

/**
 * `true` quando o texto NÃO pode aparecer na superfície pública: linguagem de valor
 * (containsValueLanguage) OU qualquer forma de probabilidade/preço em PUBLIC_UNSAFE_PATTERNS.
 * Sem fronteira de palavra nos decimais, de propósito (review #384).
 */
export function unsafeForPublic(text: string): boolean {
  return (
    containsValueLanguage(text) ||
    PUBLIC_UNSAFE_PATTERNS.some((re) => re.test(text))
  );
}
