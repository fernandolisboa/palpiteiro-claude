// Da saída do LLM à manchete que vai pro banco (#668, ADR 0072). PURO.
//
// - Palpite decidido em código (v13): o placar, o 1º tempo e quem marca primeiro vêm do
//   pick; o texto vem do LLM, conferido. Campo de texto que falha (veredito incoerente,
//   linguagem de valor) vira o de template; falha do texto inteiro vira o palpite de
//   template, nunca palpite nenhum.
// - v12 (sem fonte de λ) e ao vivo: tudo vem do LLM, como antes.

import type { PalpiteSynthesisOutput } from "./cartridges/cartridge";
import type { PalpiteLiveOutput } from "./cartridges/live";
import type { PalpiteModelPickOutput } from "./cartridges/model-pick";
import type { PalpitePick } from "./pick";
import {
  buildLivePalpiteRows,
  buildSettleablePalpiteRows,
} from "./settleable-rows";
import { containsValueLanguage } from "./value-language-guard";
import {
  checkVerdictCoherence,
  templateNarrative,
  templateVerdict,
  type CoherenceTeams,
} from "./verdict-coherence";

export type PalpiteRows = ReturnType<typeof buildSettleablePalpiteRows>;

// Quais campos de texto saíram do template, e por quê (gravado no headline).
export type TemplatedFields = {
  verdict: boolean;
  narrative: boolean;
  reason: string;
};

export type FinalPalpite = {
  verdict: string;
  narrative: string;
  citedMarkets: string[];
  probableScore: { home: number; away: number };
  rows: PalpiteRows;
  templated: TemplatedFields | null;
};

type PickForFinal = Pick<PalpitePick, "outcome" | "score" | "firstHalfScore" | "firstToScore">;

function pickRows(
  pick: PickForFinal,
  cardsTemperature: PalpiteModelPickOutput["cardsTemperature"],
): PalpiteRows {
  return buildSettleablePalpiteRows("", {
    probableScore: pick.score,
    firstHalfScore: pick.firstHalfScore,
    firstToScore: pick.firstToScore,
    ...(cardsTemperature ? { cardsTemperature } : {}),
  });
}

function mergeTemplated(
  a: TemplatedFields | null,
  b: TemplatedFields | null,
): TemplatedFields | null {
  if (!a) return b;
  if (!b) return a;
  return {
    verdict: a.verdict || b.verdict,
    narrative: a.narrative || b.narrative,
    reason: `${a.reason}; ${b.reason}`,
  };
}

/** v13: o texto do LLM sobre o pick; veredito incoerente → veredito de template. */
export function finalizeModelPick(
  output: PalpiteModelPickOutput,
  pick: PickForFinal,
  teams: CoherenceTeams,
): FinalPalpite {
  const coherence = checkVerdictCoherence(output.verdict, output.verdictOutcome, pick, teams);
  return {
    verdict: coherence.ok ? output.verdict : templateVerdict(pick, teams),
    narrative: output.narrative,
    citedMarkets: output.citedMarkets,
    probableScore: { ...pick.score },
    rows: pickRows(pick, output.cardsTemperature),
    templated: coherence.ok
      ? null
      : { verdict: true, narrative: false, reason: coherence.reason },
  };
}

/** O palpite inteiro de template (texto do LLM indisponível ou rejeitado). */
export function templateModelPick(
  pick: PickForFinal,
  teams: CoherenceTeams,
  reason: string,
): FinalPalpite {
  return {
    verdict: templateVerdict(pick, teams),
    narrative: templateNarrative(pick, teams),
    citedMarkets: [],
    probableScore: { ...pick.score },
    rows: pickRows(pick, undefined),
    templated: { verdict: true, narrative: true, reason },
  };
}

/** Algum campo que cruza pra manchete/view tem linguagem de valor (ADR 0030 §3)? */
export function finalLeaksValue(final: FinalPalpite): boolean {
  return (
    containsValueLanguage(final.verdict) ||
    containsValueLanguage(final.narrative) ||
    final.rows.some((r) => containsValueLanguage(r.text)) ||
    final.citedMarkets.some(containsValueLanguage)
  );
}

/**
 * Só os campos que vazaram linguagem de valor trocam pelo template; rótulo citado que
 * vazou sai da lista. As linhas são de templates fixos (nunca vazam).
 */
export function repairValueLeaks(
  final: FinalPalpite,
  pick: PickForFinal,
  teams: CoherenceTeams,
): FinalPalpite {
  const verdictLeak = containsValueLanguage(final.verdict);
  const narrativeLeak = containsValueLanguage(final.narrative);
  return {
    ...final,
    verdict: verdictLeak ? templateVerdict(pick, teams) : final.verdict,
    narrative: narrativeLeak ? templateNarrative(pick, teams) : final.narrative,
    citedMarkets: final.citedMarkets.filter((m) => !containsValueLanguage(m)),
    templated: mergeTemplated(
      final.templated,
      verdictLeak || narrativeLeak
        ? { verdict: verdictLeak, narrative: narrativeLeak, reason: "linguagem de valor" }
        : null,
    ),
  };
}

/** v12: o LLM escolheu resultado e placar (sem fonte de λ no run). */
export function finalizeLlmPick(output: PalpiteSynthesisOutput): FinalPalpite {
  return {
    verdict: output.verdict,
    narrative: output.narrative,
    citedMarkets: output.citedMarkets,
    probableScore: { ...output.probableScore },
    rows: buildSettleablePalpiteRows("", output),
    templated: null,
  };
}

/** Ao vivo (palpites_live_v2): só as linhas do placar final. */
export function finalizeLivePick(output: PalpiteLiveOutput): FinalPalpite {
  return {
    verdict: output.verdict,
    narrative: output.narrative,
    citedMarkets: output.citedMarkets,
    probableScore: { ...output.probableScore },
    rows: buildLivePalpiteRows("", output),
    templated: null,
  };
}
