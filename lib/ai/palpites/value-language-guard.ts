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
const RETORNO = /\bretornos?\b/i;
const REAIS = /R\$/i;

const VALUE_LANGUAGE_PATTERNS: RegExp[] = [
  /\bedge\b/i,
  /\bev\b/i,
  /\bvalor\s+esperado\b/i,
  /\bexpected\s+value\b/i,
  /\bstake\b/i,
  /\bunidades?\b/i,
  /\byield\b/i,
  /\blucros?\b/i,
  RETORNO,
  /\bprofit\b/i,
  /\bodds?\b/i,
  /\bcota(?:ç(?:ã|a)o|ções|coes)\b/i,
  // R$ — símbolo de moeda (escapa o $). Sem word-boundary (\b não casa antes de $).
  REAIS,
];

/**
 * `true` se `text` contém QUALQUER termo de linguagem de valor (ADR 0030 §3). Usado
 * no generator pós-Zod sobre verdict + narrative + o `text` da linha settleable.
 */
export function containsValueLanguage(text: string): boolean {
  return VALUE_LANGUAGE_PATTERNS.some((re) => re.test(text));
}

// Linguagem de valor NA NOTÍCIA (entrada da síntese, #670). Na matéria, "retorno" é a
// volta de jogador e "R$" é salário/multa/contratação: não são linguagem de aposta ali,
// e tirar a notícia por isso perde "o retorno de Arrascaeta". O resto da lista de saída
// vale, mais o vocabulário de casa de aposta ("aposta em Fulano" sozinho é escolha do
// técnico, não entra). O modelo é instruído a não ecoar "retorno"/R$ (o guard de saída
// continua barrando os dois na manchete).
const NEWS_EXTRA_PATTERNS: RegExp[] = [
  /\bapostas\b/i,
  /\bapostador(?:es|as?)?\b/i,
  /\bcasas?\s+de\s+apostas?\b/i,
];
const NEWS_VALUE_LANGUAGE_PATTERNS: RegExp[] = [
  ...VALUE_LANGUAGE_PATTERNS.filter((re) => re !== RETORNO && re !== REAIS),
  ...NEWS_EXTRA_PATTERNS,
];

/** `true` se um título/trecho de notícia tem linguagem de valor (ver acima). */
export function containsNewsValueLanguage(text: string): boolean {
  return NEWS_VALUE_LANGUAGE_PATTERNS.some((re) => re.test(text));
}
