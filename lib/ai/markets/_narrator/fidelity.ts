import type { FidelityCheck } from "@/lib/ai/palpites/fidelity-validator";

import type { NarratorOutput } from "./schemas";
import { selectionAliases } from "./labels";
import type { NarratorDecision } from "./types";

// Checagem de FIDELIDADE do narrador (ADR 0041 §4), no espírito de
// lib/ai/palpites/fidelity-validator.ts: pura, determinística, nunca lança,
// contradição-only. Reprova quando o texto (1) cita um percentual que não bate
// (±1pp) com os números persistidos da decisão ou (2) contradiz o lado: recomenda
// outra seleção, recomenda aposta num pass, ou diz "sem aposta" numa aposta.
// Reprovação → o predict usa o racional templado (nunca bloqueia a análise).

export const PERCENT_TOLERANCE_PP = 1;

// Borda esquerda + número inteiro: sem ela, "1058,4%" era lido pelo sufixo "058,4%"
// (= 58,4, um valor permitido) e passava.
const PERCENT_RE =
  /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:%|p\.\s?p\.|pp(?![\p{L}\d])|pontos percentuais)/giu;

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

function recommends(text: string, alias: string): boolean {
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
  return out;
}

export function checkNarrationFidelity(
  output: NarratorOutput,
  decision: NarratorDecision
): FidelityCheck {
  const text = [output.rationale, ...output.key_factors].join(" \n ");

  // (1) Percentuais citados.
  const allowed = allowedPercents(decision);
  for (const m of text.matchAll(PERCENT_RE)) {
    const cited = Number(m[1].replace(",", "."));
    if (!Number.isFinite(cited)) continue;
    const ok = allowed.some((a) => Math.abs(a - cited) <= PERCENT_TOLERANCE_PP);
    if (!ok) {
      return {
        ok: false,
        reason: `percentual citado ${m[0].trim()} não bate com a decisão persistida [${allowed.map((a) => a.toFixed(2)).join(", ")}]`,
      };
    }
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
        };
      }
    }
  }
  return { ok: true };
}
