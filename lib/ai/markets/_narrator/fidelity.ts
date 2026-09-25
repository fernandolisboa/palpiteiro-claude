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

const PERCENT_RE =
  /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|p\.\s?p\.|pp(?![\p{L}\d])|pontos percentuais)/giu;

// Verbos/substantivos de recomendação seguidos (só por palavras de função) do
// rótulo de uma seleção: "recomendamos o under", "a aposta é no over".
const RECOMMEND_VERB =
  "(?:recomend[\\p{L}]*|apost[\\p{L}]*|escolh[\\p{L}]*|entrada|palpite|vamos\\s+de|vai\\s+de)";
const FILLER =
  "(?:\\s+(?:o|a|os|as|no|na|nos|nas|em|pelo|pela|um|uma|de|do|da|por|para|pro|pra|é))*";

// Negação logo antes do verbo ("não recomendamos o under", "evitar apostar no
// over") — não é recomendação.
const NEGATION_BEFORE =
  /\b(?:não|nao|nem|sem|evit[\p{L}]*|nenhum[\p{L}]*)\b[^.!?;]*$/iu;
const NEGATION_WINDOW = 30;

const NO_BET_RE =
  /sem aposta|n[ãa]o (?:h[áa]|existe|vemos|encontramos|tem) valor|passar a vez|ficar de fora|melhor n[ãa]o apostar/iu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recommends(text: string, alias: string): boolean {
  const re = new RegExp(
    `${RECOMMEND_VERB}${FILLER}\\s+["'“”]?${escapeRegExp(alias)}(?![\\p{L}\\d])`,
    "giu"
  );
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - NEGATION_WINDOW), m.index);
    if (!NEGATION_BEFORE.test(before)) return true;
  }
  return false;
}

function allowedPercents(d: NarratorDecision): number[] {
  const f = d.focus;
  const out: number[] = [d.minEdgePp];
  if (f) {
    out.push(f.modelProbPct);
    if (f.impliedPct !== null) out.push(f.impliedPct);
    if (f.edgePct !== null) out.push(Math.abs(f.edgePct));
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

  // (2) Lado.
  const { marketKey, side, teams, line } = decision;
  const keys = decision.selectionKeys;
  if (side !== "pass" && NO_BET_RE.test(text)) {
    return {
      ok: false,
      reason: `texto diz que não há aposta, mas a decisão é '${side}'`,
    };
  }
  for (const key of keys) {
    if (key === side) continue;
    const chosenAliases =
      side === "pass"
        ? []
        : selectionAliases(marketKey, side, teams, line).map((a) =>
            a.toLowerCase()
          );
    for (const alias of selectionAliases(marketKey, key, teams, line)) {
      // Apelido que também descreve o lado escolhido não é contradição.
      if (chosenAliases.includes(alias.toLowerCase())) continue;
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
