// Guard de CONTEÚDO contra linguagem de valor na manchete (#353, blocker #5 / ADR
// 0030 §3). O `.strict()` do output schema só barra CHAVES extras — não o conteúdo
// das strings. Como a síntese é ALIMENTADA com edge/EV/odd (DADO), o LLM pode ecoar
// um número/termo de valor em `verdict`/`narrative`. Este guard roda PÓS-Zod sobre os
// campos de texto da manchete; um hit é tratado como `invalid_output` (path auditado)
// → throw → degrada pra palpite:null. REJEITAR > VAZAR.
//
// Termos do ADR 0030 §3, word-boundary, case-insensitive. NÃO bane "%" — a confiança
// é qualitativa (baixa/média/alta), não percentual; "%" sozinho não é linguagem de
// aposta. Cobre PT-BR e EN (o cartucho é PT-BR, mas o LLM pode escorregar pra EN).
const VALUE_LANGUAGE_PATTERNS: RegExp[] = [
  /\bedge\b/i,
  /\bev\b/i,
  /\bvalor\s+esperado\b/i,
  /\bexpected\s+value\b/i,
  /\bstake\b/i,
  /\bunidades?\b/i,
  /\byield\b/i,
  /\blucros?\b/i,
  /\bretornos?\b/i,
  /\bprofit\b/i,
  /\bodds?\b/i,
  /\bcota(?:ç(?:ã|a)o|ções|coes)\b/i,
  // R$ — símbolo de moeda (escapa o $). Sem word-boundary (\b não casa antes de $).
  /R\$/i,
];

/**
 * `true` se `text` contém QUALQUER termo de linguagem de valor (ADR 0030 §3). Usado
 * no generator pós-Zod sobre verdict + narrative + o `text` da linha settleable.
 */
export function containsValueLanguage(text: string): boolean {
  return VALUE_LANGUAGE_PATTERNS.some((re) => re.test(text));
}
