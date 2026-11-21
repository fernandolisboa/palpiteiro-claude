import {
  BET_LANGUAGE_RE,
  BOOKMAKER_NAME_RE,
  HOUSE_RE,
  IMPERATIVE_RE,
  PROMISE_RE,
  promisesGuarantee,
  URL_RE,
} from "@/lib/ai/language-guards";
import {
  PERCENT_RE,
  PERCENT_TOLERANCE_PP,
} from "@/lib/ai/markets/_narrator/fidelity";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import { scorelineKey, type FactsBlock } from "@/lib/underdog/facts";

// Guardas do painel do azarão (#671, ADR 0072 §5.4). Puras, nunca lançam. Rodam POR
// FRASE do advogado (reprovou → a frase é cortada, o resto segue) e no contraponto do
// revisor (reprovou → contraponto padrão). Números só do bloco de fatos; linguagem: as
// guardas compartilhadas (lib/ai/language-guards.ts), linguagem de valor (ADR 0030 §3),
// promessa e "bet" (o mesmo regex do voice-firewall, ADR 0070).

export type GuardCheck = { ok: true } | { ok: false; reason: string };

const OK: GuardCheck = { ok: true };
const fail = (reason: string): GuardCheck => ({ ok: false, reason });

// Placar só "N x N" / "N × N" (o prompt pede esse formato; " a " pegaria "de 2 a 3").
const SCORE_RE = /(?<![\d.,])(\d{1,2})\s*[x×]\s*(\d{1,2})(?![\d.,])/giu;
// Minuto: "30'", "30’", "30 min", "30 minutos" e "aos 30" sem unidade de outra coisa.
const MINUTE_RE = /(?<![\d.,])(\d{1,3})\s*(?:'|’|min(?:utos?)?(?![\p{L}]))/giu;
const AOS_RE =
  /(?<![\p{L}\d])aos\s+(\d{1,3})(?![\d.,'’]|\s*(?:%|[x×]\s*\d|p\.|pp|pontos|min|jogos?|gols?|vit|confronto|anos?))/giu;
// "1 jogo em cada N".
const RATIO_RE = /(?<![\d.,])1\s+(?:jogo\s+)?em\s+cada\s+(\d+)/giu;

// O mesmo regex de "bet" do __tests__/voice-firewall.test.ts (ADR 0070).
const BET_WORD_RE = /(?<![\p{L}\p{N}./-])bets?(?![\p{L}\p{N}/-])/iu;
const BARBADA_RE = /barbada/iu;
const CERTAINTY_RE = /(?<![\p{L}\d])certez\p{L}*/giu;
const WILL_WIN_RE =
  /(?<![\p{L}\d])(?:vai|v[ãa]o|ir[áa]|v[ãa]o)\s+(?:ganhar|vencer)(?![\p{L}\d])/giu;
const NEGATION_RE =
  /(?<![\p{L}\d])(?:n[ãa]o|nada|nenhum\p{L}*|nunca|sem)(?![\p{L}\d])/iu;

/** O termo aparece numa oração sem negação ("não há certeza" passa; "é certeza" não). */
function affirmed(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(re)) {
    const before = text.slice(0, m.index);
    const clause = before.slice(
      Math.max(
        ...[".", "!", "?", ";", ",", "\n"].map((c) => before.lastIndexOf(c))
      ) + 1
    );
    if (!NEGATION_RE.test(clause)) return true;
  }
  return false;
}

const parse = (s: string) => Number(s.replace(",", "."));

export function checkUnderdogNumbers(
  text: string,
  allowed: FactsBlock["allowed"]
): GuardCheck {
  for (const m of text.matchAll(PERCENT_RE)) {
    const n = parse(m[1]);
    if (
      Number.isFinite(n) &&
      !allowed.percents.some((a) => Math.abs(a - n) <= PERCENT_TOLERANCE_PP)
    ) {
      return fail(`percentual ${m[0].trim()} fora do bloco`);
    }
  }
  for (const m of text.matchAll(SCORE_RE)) {
    const key = scorelineKey(Number(m[1]), Number(m[2]));
    if (!allowed.scorelines.includes(key)) {
      return fail(`placar ${m[0].trim()} fora do bloco`);
    }
  }
  for (const re of [MINUTE_RE, AOS_RE]) {
    for (const m of text.matchAll(re)) {
      if (!allowed.minutes.includes(Number(m[1]))) {
        return fail(`minuto ${m[0].trim()} fora do bloco`);
      }
    }
  }
  for (const m of text.matchAll(RATIO_RE)) {
    if (!allowed.ratios.includes(Number(m[1]))) {
      return fail(`"${m[0].trim()}" fora do bloco`);
    }
  }
  return OK;
}

export function checkUnderdogLanguage(text: string): GuardCheck {
  if (containsValueLanguage(text)) return fail("linguagem de valor");
  if (BET_LANGUAGE_RE.test(text)) return fail("aposta");
  if (IMPERATIVE_RE.test(text)) return fail("imperativo");
  if (PROMISE_RE.test(text) || promisesGuarantee(text)) return fail("promessa");
  if (BARBADA_RE.test(text) || affirmed(text, CERTAINTY_RE)) {
    return fail("promessa");
  }
  if (affirmed(text, WILL_WIN_RE)) return fail("promessa");
  if (BOOKMAKER_NAME_RE.test(text) || HOUSE_RE.test(text)) {
    return fail("casa de apostas");
  }
  if (URL_RE.test(text)) return fail("link");
  if (BET_WORD_RE.test(text)) return fail("bet");
  return OK;
}

/** Uma frase do advogado: ids que existem no bloco, números do bloco e linguagem. */
export function checkAdvocateSentence(
  sentence: { texto: string; fatos: string[] },
  block: FactsBlock
): GuardCheck {
  const missing = sentence.fatos.find((id) => !block.ids.has(id));
  if (missing) return fail(`fato ${missing} não existe no bloco`);
  const numbers = checkUnderdogNumbers(sentence.texto, block.allowed);
  if (!numbers.ok) return numbers;
  return checkUnderdogLanguage(sentence.texto);
}

const words = (s: string) =>
  s
    .toLocaleLowerCase("pt-BR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function ngrams(s: string, n: number): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export const COUNTERPOINT_ECHO_WORDS = 6;

/**
 * O contraponto: números do bloco, linguagem e nenhuma sequência de 6+ palavras de uma
 * frase cortada (o revisor não pode reabilitar o que foi cortado).
 */
export function checkCounterpoint(
  text: string,
  block: FactsBlock,
  cutTexts: string[]
): GuardCheck {
  const numbers = checkUnderdogNumbers(text, block.allowed);
  if (!numbers.ok) return numbers;
  const language = checkUnderdogLanguage(text);
  if (!language.ok) return language;
  const mine = ngrams(text, COUNTERPOINT_ECHO_WORDS);
  for (const cut of cutTexts) {
    for (const g of ngrams(cut, COUNTERPOINT_ECHO_WORDS)) {
      if (mine.has(g)) return fail("contraponto repete frase cortada");
    }
  }
  return OK;
}
