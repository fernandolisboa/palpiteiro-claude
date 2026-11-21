import type { NarratorOutput } from "./schemas";
import { selectionAliases, selectionLabel } from "./labels";
import type { NarratorDecision } from "./types";

// Checagem de FIDELIDADE do narrador (ADR 0041 §4), no espírito de
// lib/ai/palpites/fidelity-validator.ts: pura, determinística, nunca lança,
// contradição-only. Reprova quando o texto (1) cita um percentual que não bate
// (±1pp) com os números persistidos da decisão ou (2) contradiz o lado: recomenda
// outra seleção, recomenda aposta num pass, ou diz "sem aposta" numa aposta.
// Reprovação → o predict usa o racional templado (nunca bloqueia a análise).

export const PERCENT_TOLERANCE_PP = 1;

// Borda esquerda + número inteiro: sem ela, "1058,4%" era lido pelo sufixo "058,4%"
// (= 58,4, um valor permitido) e passava. Só bloqueia dígito (ou dígito+separador)
// antes: "58%,42%" e "over.58%" seguem checados.
export const PERCENT_RE =
  /(?<!\d)(?<!\d[.,])(\d+(?:[.,]\d+)?)\s*(?:%|p\.\s?p\.|pp(?![\p{L}\d])|pontos percentuais)/giu;

// Verbos/substantivos de recomendação seguidos (só por palavras de função) do
// rótulo de uma seleção: "recomendamos o under", "a aposta é no over". Sem
// "do/da" no filler: "a aposta do Bahia" é possessivo, não recomendação.
const RECOMMEND_VERB =
  "(?:recomend[\\p{L}]*|apost[\\p{L}]*|escolh[\\p{L}]*|entrada|palpite|vamos\\s+de|vai\\s+de)";
const FILLER =
  "(?:\\s+(?:o|a|os|as|no|na|nos|nas|em|pelo|pela|um|uma|de|por|para|pro|pra|é))*";

// Recomendação com o rótulo ANTES: "o under é a melhor escolha", "o over vale a
// aposta".
const POSITIVE_AFTER =
  "\\s+(?:(?:é|seria|parece(?:\\s+ser)?)\\s+(?:a\\s+|o\\s+)?(?:melhor|mais\\s+indicad[ao])\\s+(?:escolha|opç[ãa]o|aposta|entrada|pedida|caminho)|vale\\s+a\\s+(?:aposta|pena))";

// Negação logo antes do verbo/rótulo ("não recomendamos o under", "evitar apostar
// no over") ou logo depois ("a aposta no over não se paga") — não é
// recomendação.
const NEGATION_BEFORE =
  /\b(?:não|nao|nem|sem|evit[\p{L}]*|nenhum[\p{L}]*)\b[^.!?;]*$/iu;
const NEGATION_AFTER =
  /^[^.!?;]*?(?:\bn[ãa]o\s+(?:se\s+paga|tem\s+valor|compensa|vale)|\bsem\s+valor)/iu;
const NEGATION_WINDOW = 30;

// "Sem aposta"/"não há valor": contradiz uma aposta só quando NÃO está amarrado
// ao rótulo de outra seleção ("não há valor no under" numa aposta no over é
// coerente).
const NO_BET_RE =
  /sem aposta|n[ãa]o (?:h[áa]|existe|vemos|encontramos|tem) valor|passar a vez|ficar de fora|melhor n[ãa]o apostar/giu;
const NO_BET_TIE_WINDOW = 40;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasRe(alias: string): string {
  return `(?<![\\p{L}\\d])${escapeRegExp(alias)}(?![\\p{L}\\d])`;
}

function negatedBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return NEGATION_BEFORE.test(before);
}

function negatedAfter(text: string, end: number): boolean {
  return NEGATION_AFTER.test(text.slice(end, end + NEGATION_WINDOW));
}

export function recommends(text: string, alias: string): boolean {
  const forward = new RegExp(
    `${RECOMMEND_VERB}${FILLER}\\s+["'“”]?${aliasRe(alias)}`,
    "giu"
  );
  for (const m of text.matchAll(forward)) {
    if (negatedBefore(text, m.index)) continue;
    if (negatedAfter(text, m.index + m[0].length)) continue;
    return true;
  }
  const backward = new RegExp(`${aliasRe(alias)}${POSITIVE_AFTER}`, "giu");
  for (const m of text.matchAll(backward)) {
    if (!negatedBefore(text, m.index)) return true;
  }
  return false;
}

// Trecho da mesma frase em volta de [start, end) cita o rótulo de outra seleção?
function tiedToAlias(
  text: string,
  start: number,
  end: number,
  aliases: readonly string[]
): boolean {
  const before = text
    .slice(Math.max(0, start - NO_BET_TIE_WINDOW), start)
    .split(/[.!?;]/)
    .pop();
  const after = text.slice(end, end + NO_BET_TIE_WINDOW).split(/[.!?;]/)[0];
  const around = `${before ?? ""} ${after}`;
  return aliases.some((a) => new RegExp(aliasRe(a), "iu").test(around));
}

// Reprovação da narração. `feedback` (opcional) é o motivo com os rótulos que o modelo
// leu no bloco "Decisão" ("Empate", "Vitória do X"), pra 2ª tentativa (#669);
// `reason` segue com as chaves cruas ('draw', 'home') e é o que vai pro error_message.
export type NarrationFidelityCheck =
  | { ok: true }
  | { ok: false; reason: string; feedback?: string };

// Lista global (fallback quando a frase não cita nenhuma seleção).
function allowedPercents(d: NarratorDecision): number[] {
  const f = d.focus;
  const out: number[] = [d.minEdgePp];
  if (f) {
    out.push(f.modelProbPct);
    if (f.impliedPct !== null) out.push(f.impliedPct);
    if (f.edgePct !== null) out.push(Math.abs(f.edgePct));
    // Mercado de 2 vias (over/under, ambas marcam): o complemento é a mesma
    // informação vista do outro lado ("58% over" ⇔ "42% under") — citação fiel.
    if (d.selectionKeys.length === 2) {
      out.push(100 - f.modelProbPct);
      if (f.impliedPct !== null) out.push(100 - f.impliedPct);
    }
  }
  // narrator_v1.5 (#669): a chance do modelo e a implícita de cada seleção estão no
  // bloco "Decisão" e são citáveis (ex.: a chance do favorito num 1X2). O edge das
  // outras não está lá e não entra. A checagem de lado não muda.
  for (const s of d.selections) {
    out.push(s.modelProbPct);
    if (s.impliedPct !== null) out.push(s.impliedPct);
  }
  return out;
}

// Números de UMA seleção (#669, code review): quando a frase cita a seleção, o
// percentual tem de ser dela, senão "o CR Flamengo tem 34,4%" passava com o número do
// visitante. `modelOnly` = só o lado do modelo (frase que atribui o número ao modelo).
function selectionPercents(
  d: NarratorDecision,
  key: string,
  modelOnly: boolean
): number[] {
  // Em 2 vias o outro lado é o complemento (e o edge é o mesmo, com sinal trocado):
  // cada lado aceita os números dos dois, como antes.
  const twoWay = d.selectionKeys.length === 2;
  const f = d.focus;
  const focusCounts = f !== null && (twoWay || f.key === key);
  const out: number[] = [d.minEdgePp];
  if (focusCounts && f.edgePct !== null) out.push(Math.abs(f.edgePct));
  const sides = [
    ...d.selections.filter((s) => twoWay || s.key === key),
    ...(focusCounts ? [f] : []),
  ];
  for (const s of sides) {
    const values = [s.modelProbPct];
    if (!modelOnly && s.impliedPct !== null) values.push(s.impliedPct);
    out.push(...values);
    if (twoWay) out.push(...values.map((v) => 100 - v));
  }
  return out;
}

// Só o lado do modelo, sem frase citando seleção.
function modelPercents(d: NarratorDecision): number[] {
  const keys = new Set([
    ...d.selections.map((s) => s.key),
    ...(d.focus ? [d.focus.key] : []),
  ]);
  if (keys.size === 0) return [d.minEdgePp];
  return [...keys].flatMap((k) => selectionPercents(d, k, true));
}

// Palavras de papel no 1X2 que não são apelido de recomendação (ficam fora de
// `selectionAliases` pra não mexer na checagem de lado), mas ligam o número à seleção.
const ROLE_WORDS: Record<string, Record<string, string[]>> = {
  match_result: {
    home: [
      "mandante",
      "mandantes",
      "time da casa",
      "dono da casa",
      "donos da casa",
    ],
    away: ["visitante", "visitantes", "time de fora"],
  },
};

// Fim de frase: . ! ? ; ou quebra de linha. Ponto seguido de dígito é decimal ("2.5").
const SENTENCE_END = /[!?;\n]|\.(?!\d)/u;
const SENTENCE_END_G = /[!?;\n]|\.(?!\d)/gu;

function sentenceAround(text: string, start: number, end: number): string {
  let from = 0;
  for (const m of text.slice(0, start).matchAll(SENTENCE_END_G)) {
    from = m.index + m[0].length;
  }
  const tail = text.slice(end);
  const stop = tail.search(SENTENCE_END);
  return text.slice(from, stop < 0 ? text.length : end + stop);
}

// Atribuição explícita ao modelo logo antes do número, na mesma oração ("o modelo dá
// 39,8%"): aí o número tem de ser do lado do modelo, não a implícita. Conservador:
// qualquer menção ao preço na oração (antes ou logo depois) desliga a regra.
const MODEL_WORD = /\bmodelo\b/iu;
const PRICE_WORD =
  /implícit|implicit|mercado|\bodds?\b|preço|cotaç|casas? de apostas?|bookmaker/iu;
const PRICE_LOOKAHEAD = 25;

function attributedToModel(
  text: string,
  clauseFrom: number,
  start: number,
  end: number,
  unit: string
): boolean {
  if (!unit.startsWith("%")) return false; // pp é edge/piso, não chance.
  const before = text.slice(clauseFrom, start).split(/[,:]/).pop() ?? "";
  const after = text.slice(end, end + PRICE_LOOKAHEAD).split(/[,:;.!?\n]/)[0];
  return (
    MODEL_WORD.test(before) &&
    !PRICE_WORD.test(before) &&
    !PRICE_WORD.test(after)
  );
}

function fmtList(values: readonly number[]): string {
  return values.map((a) => a.toFixed(2)).join(", ");
}

export function checkNarrationFidelity(
  output: NarratorOutput,
  decision: NarratorDecision
): NarrationFidelityCheck {
  const text = [output.rationale, ...output.key_factors].join(" \n ");
  const label = (key: string) =>
    selectionLabel(decision.marketKey, key, decision.teams, decision.line);

  // (1) Percentuais citados. A frase que cita uma (ou mais) seleções amarra o número a
  // elas; sem seleção na frase, vale a lista global.
  const allowed = allowedPercents(decision);
  const labelRes = decision.selectionKeys.map((key) => ({
    key,
    res: [
      ...selectionAliases(
        decision.marketKey,
        key,
        decision.teams,
        decision.line
      ),
      ...(ROLE_WORDS[decision.marketKey]?.[key] ?? []),
    ].map((a) => new RegExp(aliasRe(a), "iu")),
  }));
  let prevEnd = 0;
  for (const m of text.matchAll(PERCENT_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    const cited = Number(m[1].replace(",", "."));
    const sentence = sentenceAround(text, start, end);
    const sentenceFrom = text.lastIndexOf(sentence, start);
    const clauseFrom = Math.max(prevEnd, sentenceFrom);
    prevEnd = end;
    if (!Number.isFinite(cited)) continue;
    const unit = m[0].slice(m[1].length).trim();
    const modelOnly = attributedToModel(text, clauseFrom, start, end, unit);
    const keys = labelRes
      .filter(({ res }) => res.some((re) => re.test(sentence)))
      .map(({ key }) => key);
    const pool =
      keys.length > 0
        ? keys.flatMap((k) => selectionPercents(decision, k, modelOnly))
        : modelOnly
          ? modelPercents(decision)
          : allowed;
    if (pool.some((a) => Math.abs(a - cited) <= PERCENT_TOLERANCE_PP)) continue;
    const what = modelOnly ? "como chance do modelo " : "";
    if (keys.length > 0) {
      const raw = keys.map((k) => `'${k}'`).join(", ");
      const named = keys.map((k) => `'${label(k)}'`).join(", ");
      return {
        ok: false,
        reason: `percentual citado ${m[0].trim()} ${what}não bate com ${raw}, citada na mesma frase [${fmtList(pool)}]`,
        feedback: `percentual citado ${m[0].trim()} ${what}não bate com os números de ${named}, citada na mesma frase`,
      };
    }
    return {
      ok: false,
      reason: `percentual citado ${m[0].trim()} ${what}não bate com a decisão persistida [${fmtList(pool)}]`,
    };
  }

  // (2) Lado. Conservador: na dúvida, passa — os números persistidos mandam; a
  // checagem só pega contradição clara.
  const { marketKey, side, teams, line } = decision;
  const chosenAliases =
    side === "pass"
      ? []
      : selectionAliases(marketKey, side, teams, line).map((a) =>
          a.toLowerCase()
        );
  // Apelido que também descreve o lado escolhido não é contradição.
  const otherAliases = new Map<string, string[]>();
  for (const key of decision.selectionKeys) {
    if (key === side) continue;
    otherAliases.set(
      key,
      selectionAliases(marketKey, key, teams, line).filter(
        (a) => !chosenAliases.includes(a.toLowerCase())
      )
    );
  }
  if (side !== "pass") {
    const allOther = [...otherAliases.values()].flat();
    for (const m of text.matchAll(NO_BET_RE)) {
      if (tiedToAlias(text, m.index, m.index + m[0].length, allOther)) continue;
      return {
        ok: false,
        reason: `texto diz que não há aposta, mas a decisão é '${side}'`,
        feedback: `texto diz que não há aposta, mas a decisão é '${label(side)}'`,
      };
    }
  }
  for (const [key, aliases] of otherAliases) {
    for (const alias of aliases) {
      if (recommends(text, alias)) {
        return {
          ok: false,
          reason:
            side === "pass"
              ? `texto recomenda '${key}' numa decisão sem aposta`
              : `texto recomenda '${key}', mas a decisão é '${side}'`,
          feedback:
            side === "pass"
              ? `texto recomenda '${label(key)}' numa decisão sem aposta`
              : `texto recomenda '${label(key)}', mas a decisão é '${label(side)}'`,
        };
      }
    }
  }
  return { ok: true };
}
