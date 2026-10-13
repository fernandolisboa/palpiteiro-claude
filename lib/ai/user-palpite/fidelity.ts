import { PERCENT_RE, PERCENT_TOLERANCE_PP } from "@/lib/ai/markets/_narrator/fidelity";
import type { FidelityCheck } from "@/lib/ai/palpites/fidelity-validator";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { PalpiteNarration } from "@/lib/user-palpite/types";

import { allowedPercents, type NarrationInput } from "./narrate-cartridge";

// Guardas da narração do "Seu palpite" (#564, ADR 0055 Decisão 5). Puras, nunca lançam,
// e rodam SÓ nos campos que o LLM escreveu (o template usa texto do código). Reprovou →
// a narração vira o template e a row de ai_calls fica `invalid_output`.

// Mandar apostar (ou falar de aposta) não cabe numa leitura de probabilidade. Lookarounds
// de letra: o \b do JS não enxerga letra acentuada.
const BET_LANGUAGE_RE =
  /(?<![\p{L}\d])(?:apost\p{L}*|v[áa]\s+de|vai\s+de|vamos\s+de|entr[ae]\s+n[oa]s?\s+(?:over|under|mercado))(?![\p{L}\d])/iu;

function llmText(o: PalpiteNarration): string {
  return [o.resumo, ...o.pontos, ...o.discordancias.map((d) => d.texto)].join(" \n ");
}

export function checkPalpiteNarrationFidelity(
  o: PalpiteNarration,
  i: NarrationInput,
): FidelityCheck {
  const text = llmText(o);

  const allowed = allowedPercents(i);
  for (const m of text.matchAll(PERCENT_RE)) {
    const cited = Number(m[1].replace(",", "."));
    if (!Number.isFinite(cited)) continue;
    if (!allowed.some((a) => Math.abs(a - cited) <= PERCENT_TOLERANCE_PP)) {
      return { ok: false, reason: `fidelity: percentual ${m[0].trim()} fora da leitura` };
    }
  }

  const clash =
    (o.veredito === "concordo" && i.codeVerdict === "discordo") ||
    (o.veredito === "discordo" && i.codeVerdict === "concordo");
  if (clash) {
    return {
      ok: false,
      reason: `fidelity: veredito ${o.veredito} contradiz o do código (${i.codeVerdict})`,
    };
  }

  const contradicted = new Set(
    i.claims.filter((c) => c.status === "contradicted").map((c) => c.index),
  );
  const seen = new Set<number>();
  for (const d of o.discordancias) {
    if (!contradicted.has(d.claimIndex) || seen.has(d.claimIndex)) {
      return {
        ok: false,
        reason: `fidelity: discordância na afirmação ${d.claimIndex}, que não é contradita (ou repetida)`,
      };
    }
    seen.add(d.claimIndex);
  }
  return { ok: true };
}

/** Linguagem de valor (ADR 0030 §3) ou de aposta nos campos escritos pelo LLM. */
export function checkPalpiteNarrationLanguage(o: PalpiteNarration): FidelityCheck {
  const text = llmText(o);
  if (containsValueLanguage(text)) return { ok: false, reason: "value_language" };
  if (BET_LANGUAGE_RE.test(text)) return { ok: false, reason: "value_language: aposta" };
  return { ok: true };
}
