import {
  PERCENT_RE,
  PERCENT_TOLERANCE_PP,
} from "@/lib/ai/markets/_narrator/fidelity";
import type { FidelityCheck } from "@/lib/ai/palpites/fidelity-validator";
import type { BetExplainInput } from "@/lib/bets/explain-input";

import { allowedNumbers } from "./cartridge";
import type { BetExplanation } from "./schema";

// Guardas do "Explicar com IA" (#562, ADR 0063). Puras, nunca lançam. Reprovou → a
// explicação vira o template (texto do código) e a row de ai_calls fica
// `invalid_output`. NÃO reusa o guard do "Seu palpite" (ADR 0055): lá odd, edge, stake
// e "aposta" são proibidos; aqui é a superfície de valor (ADR 0034 §9).

const POINTS_TOLERANCE = 0.15;
const DECIMAL_TOLERANCE = 0.011;
const UNITS_TOLERANCE = 0.011;

// Edge em pontos ("+4,2 pontos", "4,2 pontos"); "pontos percentuais" fica com o
// PERCENT_RE.
const POINTS_RE =
  /(?<!\d)(?<!\d[.,])[+\-−]?(\d+(?:[.,]\d+)?)\s*pontos(?!\s+percentuais)(?![\p{L}])/giu;
// Stake: "1u", "0,5u", "2 unidades".
const UNITS_RE =
  /(?<!\d)(?<!\d[.,])(\d+(?:[.,]\d+)?)\s*(?:u|unidades?)(?![\p{L}\d])/giu;
// Decimal solto (odd, linha): o que vier seguido de %, pontos, pp ou unidade é das
// famílias acima.
const DECIMAL_RE =
  /(?<![\d.,])(\d+[.,]\d+)(?!\d)(?!\s*(?:%|p\.\s?p\.|pp(?![\p{L}\d])|pontos|u(?![\p{L}])|unidade))/giu;

// Mandar apostar ou mexer na aposta. Lookarounds de letra: o \b do JS não enxerga
// letra acentuada.
// "Recomendação" e "recomendado pelas bandas" descrevem; só a forma ativa sem "não"
// antes é ordem.
const IMPERATIVE_RE =
  /(?<![\p{L}\d])(?:aposte|apostem|apostaria|v[áa]\s+de|vai\s+de|vamos\s+de|entre\s+n[oa]s?|entre\s+nessa|coloque|aumente|diminua|reduza|dobre|troque|aproveite|jogue|pegue|sugiro|deveria\s+apostar|vale\s+apostar)(?![\p{L}\d])|(?<!n[ãa]o\s)(?<![\p{L}\d])(?:recomendo|recomendamos|recomenda-se|recomendaria|recomende|recomendem)(?![\p{L}\d])/iu;
// Promessa. "garantid*" só conta fora de negação: "isso não é uma vantagem garantida"
// é o aviso do backtest (a negação vale pra oração inteira).
const PROMISE_RE =
  /(?<![\p{L}\d])(?:lucro\s+certo|dinheiro\s+f[áa]cil|imperd[íi]vel|aposta\s+certa|com\s+certeza|sem\s+risco)(?![\p{L}\d])/iu;
const GUARANTEE_RE = /(?<![\p{L}\d])garantid\p{L}*/giu;
const NEGATION_RE =
  /(?<![\p{L}\d])(?:n[ãa]o|nada|nenhum\p{L}*|nunca|sem)(?![\p{L}\d])/iu;

function promisesGuarantee(text: string): boolean {
  for (const m of text.matchAll(GUARANTEE_RE)) {
    const before = text.slice(0, m.index);
    const clause = before.slice(
      Math.max(
        ...[".", "!", "?", ";", "\n"].map((c) => before.lastIndexOf(c))
      ) + 1
    );
    if (!NEGATION_RE.test(clause)) return true;
  }
  return false;
}
export const BOOKMAKER_NAME_RE =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;
const HOUSE_RE =
  /casas?\s+de\s+apostas?|(?:odds?|margem)\s+da\s+(?:sua\s+)?casa/iu;
const URL_RE = /https?:\/\/|www\.|\.com\b|\.bet\b/iu;

// Contradição do veredito, por perna: "tem valor" numa perna sem valor e vice-versa.
const SAYS_NO_VALUE_RE =
  /n[ãa]o\s+tem\s+valor|sem\s+valor|n[ãa]o\s+(?:vale|compensa|se\s+paga)/iu;
// Sem "se paga": descrever o break-even ("só se paga se a chance passar de…") é a
// explicação pedida, não um veredito.
const SAYS_VALUE_RE =
  /(?<!n[ãa]o\s)(?<![\p{L}])(?:tem\s+valor|com\s+valor|vale\s+a\s+pena)(?![\p{L}])/iu;

function llmTexts(o: BetExplanation): string[] {
  return [
    o.resumo,
    ...o.pernas.map((p) => p.texto),
    ...(o.combinada ? [o.combinada] : []),
  ];
}

const near = (allowed: readonly number[], n: number, tol: number) =>
  allowed.some((a) => Math.abs(a - n) <= tol);

const parse = (s: string) => Number(s.replace(",", "."));

export function checkExplanationFidelity(
  o: BetExplanation,
  i: BetExplainInput
): FidelityCheck {
  // Uma explicação por perna avaliada, nem a mais nem a menos.
  const expected = new Set(i.legs.map((l) => l.index));
  const seen = new Set<number>();
  for (const p of o.pernas) {
    if (!expected.has(p.indice) || seen.has(p.indice)) {
      return {
        ok: false,
        reason: `fidelity: perna ${p.indice} inesperada ou repetida`,
      };
    }
    seen.add(p.indice);
  }
  if (seen.size !== expected.size) {
    return { ok: false, reason: "fidelity: faltou explicar alguma perna" };
  }
  if ((o.combinada === null) !== (i.combo === null)) {
    return { ok: false, reason: "fidelity: combinada ausente ou a mais" };
  }

  const allowed = allowedNumbers(i);
  const text = llmTexts(o).join(" \n ");
  for (const m of text.matchAll(PERCENT_RE)) {
    const n = parse(m[1]);
    if (
      Number.isFinite(n) &&
      !near(allowed.percents, n, PERCENT_TOLERANCE_PP)
    ) {
      return {
        ok: false,
        reason: `fidelity: percentual ${m[0].trim()} fora da avaliação`,
      };
    }
  }
  for (const m of text.matchAll(POINTS_RE)) {
    const n = parse(m[1]);
    if (Number.isFinite(n) && !near(allowed.points, n, POINTS_TOLERANCE)) {
      return {
        ok: false,
        reason: `fidelity: ${m[0].trim()} fora da avaliação`,
      };
    }
  }
  for (const m of text.matchAll(UNITS_RE)) {
    const n = parse(m[1]);
    if (Number.isFinite(n) && !near(allowed.units, n, UNITS_TOLERANCE)) {
      return {
        ok: false,
        reason: `fidelity: stake ${m[0].trim()} fora da avaliação`,
      };
    }
  }
  for (const m of text.matchAll(DECIMAL_RE)) {
    const n = parse(m[1]);
    if (Number.isFinite(n) && !near(allowed.decimals, n, DECIMAL_TOLERANCE)) {
      return {
        ok: false,
        reason: `fidelity: número ${m[0].trim()} fora da avaliação`,
      };
    }
  }

  // O veredito é do código: o texto de cada perna não pode dizer o contrário.
  // Com a odd de mercado contando outra história (coherenceWarning), o texto fala dos
  // dois lados de propósito: sem checagem.
  const byIndex = new Map(i.legs.map((l) => [l.index, l]));
  const clash = (reading: string | null, t: string) =>
    (reading === "negative" && SAYS_VALUE_RE.test(t)) ||
    (reading === "positive" && SAYS_NO_VALUE_RE.test(t));
  for (const p of o.pernas) {
    const l = byIndex.get(p.indice);
    if (l && !l.coherenceWarning && clash(l.reading, p.texto)) {
      return {
        ok: false,
        reason: `fidelity: perna ${p.indice} contradiz o veredito`,
      };
    }
  }
  if (o.combinada && i.combo && clash(i.combo.reading, o.combinada)) {
    return { ok: false, reason: "fidelity: combinada contradiz o veredito" };
  }
  return { ok: true };
}

/** Mandar apostar, prometer, citar casa ou link: nos campos escritos pelo LLM. */
export function checkExplanationLanguage(o: BetExplanation): FidelityCheck {
  const text = llmTexts(o).join(" \n ");
  if (IMPERATIVE_RE.test(text))
    return { ok: false, reason: "language: imperativo" };
  if (PROMISE_RE.test(text) || promisesGuarantee(text)) {
    return { ok: false, reason: "language: promessa" };
  }
  if (BOOKMAKER_NAME_RE.test(text) || HOUSE_RE.test(text)) {
    return { ok: false, reason: "language: casa de apostas" };
  }
  if (URL_RE.test(text)) return { ok: false, reason: "language: link" };
  return { ok: true };
}
