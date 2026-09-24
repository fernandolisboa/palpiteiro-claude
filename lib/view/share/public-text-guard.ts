// Guard de RENDER do texto livre na superfície pública /p (ADR 0035 §2d / #438). Fonte
// ÚNICA pra página, metadata, imagem OG e títulos de fonte: odds/EV/edge/stake/%/R$ NUNCA
// saem no público. containsValueLanguage (denylist de 13 termos do guard de geração) NÃO
// basta — não bane "%" nem um preço/probabilidade solto ("2.10", "1,95") — então este guard
// é MAIS ESTRITO. Um falso-positivo (ex.: "1.5 gol por jogo") só degrada o texto; um
// falso-negativo publicaria um número de valor, que é o risco regulatório.

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

/**
 * `true` quando o texto NÃO pode aparecer na superfície pública: linguagem de valor
 * (containsValueLanguage) OU "%" OU qualquer decimal solto. `\d+[.,]\d+` pega 1-2 casas
 * ("2.10") E 3+ ("1.955") — sem fronteira de palavra, de propósito (review #384).
 */
export function unsafeForPublic(text: string): boolean {
  return (
    containsValueLanguage(text) || /%/.test(text) || /\d+[.,]\d+/.test(text)
  );
}
