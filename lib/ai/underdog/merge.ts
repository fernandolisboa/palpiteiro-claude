import type { FactsBlock } from "@/lib/underdog/facts";
import type { UnderdogFacts, UnderdogNarrative } from "@/lib/underdog/types";

import { templateCounterpoint } from "./fallback";
import { checkAdvocateSentence, checkCounterpoint } from "./guards";
import type { UnderdogCase, UnderdogReview } from "./schema";

// Junta o rascunho do advogado, as guardas por frase e o veredito do revisor (#671, ADR
// 0073 §5.4). Puro, nunca lança. O código corta só `sem_base`; `exagerada` fica (o
// contraponto responde). Sobra pouco → texto padrão.

export type Survivor = { text: string; facts: string[]; draftIndex: number };

export type GuardedDraft = {
  survivors: Survivor[];
  cutTexts: string[];
  total: number;
  reasons: string[];
};

/** Menos que isto sobrevivendo do rascunho → texto padrão. */
export const survivalFloor = (total: number) =>
  Math.max(2, Math.ceil(total / 2));

/** Mínimo de frases `apoiada` pra o texto da IA ir à tela. */
export const MIN_SUPPORTED = 2;

export function guardDraft(
  draft: UnderdogCase,
  block: FactsBlock
): GuardedDraft {
  const survivors: Survivor[] = [];
  const cutTexts: string[] = [];
  const reasons: string[] = [];
  draft.frases.forEach((f, i) => {
    const check = checkAdvocateSentence(f, block);
    if (check.ok) {
      survivors.push({ text: f.texto, facts: f.fatos, draftIndex: i });
    } else {
      cutTexts.push(f.texto);
      reasons.push(`[${i}] ${check.reason}`);
    }
  });
  return { survivors, cutTexts, total: draft.frases.length, reasons };
}

export const draftSurvives = (g: GuardedDraft) =>
  g.survivors.length >= survivalFloor(g.total);

export type MergeResult =
  | { ok: true; narrative: UnderdogNarrative }
  // O revisor não devolveu um veredito por frase (faltou ou repetiu): falha do revisor.
  | { ok: false; kind: "review_invalid"; reason: string }
  // Sobrou pouco depois do revisor: texto padrão (determinístico, grava).
  | { ok: false; kind: "too_few"; reason: string };

export function mergeReview(args: {
  guarded: GuardedDraft;
  review: UnderdogReview;
  block: FactsBlock;
  facts: UnderdogFacts;
  teams: { home: string; away: string };
  advocateFamily: string | null;
}): MergeResult {
  const { guarded, review, block } = args;
  const n = guarded.survivors.length;
  const byIndex = new Map<number, UnderdogReview["avaliacoes"][number]>();
  for (const a of review.avaliacoes) {
    if (a.indice >= n || byIndex.has(a.indice)) {
      return {
        ok: false,
        kind: "review_invalid",
        reason: `revisor: índice ${a.indice} inesperado ou repetido`,
      };
    }
    byIndex.set(a.indice, a);
  }
  if (byIndex.size !== n) {
    return {
      ok: false,
      kind: "review_invalid",
      reason: "revisor: faltou veredito de alguma frase",
    };
  }

  const verdicts = { apoiada: 0, exagerada: 0, sem_base: 0 };
  const kept: UnderdogNarrative["sentences"] = [];
  const cutTexts = [...guarded.cutTexts];
  guarded.survivors.forEach((s, i) => {
    const v = byIndex.get(i)!.veredito;
    verdicts[v] += 1;
    if (v === "sem_base") cutTexts.push(s.text);
    else kept.push({ text: s.text, facts: s.facts, verdict: v });
  });

  if (
    verdicts.apoiada < MIN_SUPPORTED ||
    kept.length < survivalFloor(guarded.total)
  ) {
    return {
      ok: false,
      kind: "too_few",
      reason: `sobraram ${kept.length} de ${guarded.total} (${verdicts.apoiada} apoiadas)`,
    };
  }

  const counter = checkCounterpoint(review.contraponto, block, cutTexts);
  return {
    ok: true,
    narrative: {
      sentences: kept,
      counterpoint: counter.ok
        ? review.contraponto
        : templateCounterpoint(args.facts, args.teams),
      counterpointSource: counter.ok ? "llm" : "template",
      cut: guarded.total - kept.length,
      total: guarded.total,
      verdicts,
      advocateFamily: args.advocateFamily,
    },
  };
}
