import { describe, expect, it } from "vitest";

import { templateCounterpoint } from "@/lib/ai/underdog/fallback";
import {
  draftSurvives,
  guardDraft,
  mergeReview,
  survivalFloor,
} from "@/lib/ai/underdog/merge";
import type { UnderdogReview } from "@/lib/ai/underdog/schema";

import { block, facts, goodDraft, goodReview, TEAMS } from "./fixtures";

function merge(review: UnderdogReview, draft = goodDraft()) {
  const b = block();
  return mergeReview({
    guarded: guardDraft(draft, b),
    review,
    block: b,
    facts: facts(),
    teams: TEAMS,
    advocateFamily: "Sonnet",
  });
}

const verdict = (
  review: UnderdogReview,
  i: number,
  v: "apoiada" | "exagerada" | "sem_base"
): UnderdogReview => ({
  ...review,
  avaliacoes: review.avaliacoes.map((a) =>
    a.indice === i ? { ...a, veredito: v } : a
  ),
});

describe("guardDraft / survivalFloor", () => {
  it("piso: max(2, metade arredondada pra cima)", () => {
    expect([3, 4, 5, 6].map(survivalFloor)).toEqual([2, 2, 3, 3]);
  });

  it("frase reprovada é cortada, o resto segue", () => {
    const draft = goodDraft();
    draft.frases[2] = { texto: "Aposte na zebra.", fatos: ["F1"] };
    const g = guardDraft(draft, block());
    expect(g.survivors.map((s) => s.draftIndex)).toEqual([0, 1, 3]);
    expect(g.cutTexts).toEqual(["Aposte na zebra."]);
    expect(draftSurvives(g)).toBe(true);
  });

  it("menos da metade sobrevivendo → não sobrevive", () => {
    const draft = goodDraft();
    for (const i of [0, 1, 2])
      draft.frases[i] = { texto: "A odd é boa.", fatos: ["P1"] };
    expect(draftSurvives(guardDraft(draft, block()))).toBe(false);
  });
});

describe("mergeReview", () => {
  it("tudo apoiado → texto da IA, contraponto do revisor", () => {
    const r = merge(goodReview());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.narrative.sentences).toHaveLength(4);
    expect(r.narrative.counterpointSource).toBe("llm");
    expect(r.narrative).toMatchObject({
      cut: 0,
      total: 4,
      verdicts: { apoiada: 4, exagerada: 0, sem_base: 0 },
      advocateFamily: "Sonnet",
    });
  });

  it("sem_base é cortada; exagerada fica", () => {
    const r = merge(
      verdict(verdict(goodReview(), 1, "sem_base"), 2, "exagerada")
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.narrative.sentences.map((s) => s.verdict)).toEqual([
      "apoiada",
      "exagerada",
      "apoiada",
    ]);
    expect(r.narrative.cut).toBe(1);
  });

  it("menos de 2 apoiadas → too_few (texto padrão que grava)", () => {
    const r = merge(
      verdict(
        verdict(verdict(goodReview(), 0, "exagerada"), 1, "exagerada"),
        2,
        "exagerada"
      )
    );
    expect(r).toMatchObject({ ok: false, kind: "too_few" });
  });

  it("menos da metade do rascunho sobrevivendo → too_few", () => {
    const draft = goodDraft();
    draft.frases.push(
      { texto: "A odd é boa.", fatos: ["P1"] },
      { texto: "A odd é ótima.", fatos: ["P1"] }
    );
    // 6 no rascunho, 2 cortadas nas guardas, 2 sem_base: sobram 2 < 3.
    const r = merge(
      verdict(verdict(goodReview(4), 0, "sem_base"), 1, "sem_base"),
      draft
    );
    expect(r).toMatchObject({ ok: false, kind: "too_few" });
  });

  it("revisor sem um índice ou com índice repetido → review_invalid", () => {
    const missing = {
      ...goodReview(),
      avaliacoes: goodReview().avaliacoes.slice(0, 3),
    };
    expect(merge(missing)).toMatchObject({ ok: false, kind: "review_invalid" });
    const dup = {
      ...goodReview(),
      avaliacoes: [
        ...goodReview().avaliacoes.slice(0, 3),
        { ...goodReview().avaliacoes[0] },
      ],
    };
    expect(merge(dup)).toMatchObject({ ok: false, kind: "review_invalid" });
    const outOfRange = {
      ...goodReview(),
      avaliacoes: [
        ...goodReview().avaliacoes.slice(0, 3),
        { indice: 5, veredito: "apoiada" as const, motivo: "x" },
      ],
    };
    expect(merge(outOfRange)).toMatchObject({
      ok: false,
      kind: "review_invalid",
    });
  });

  it("contraponto inválido → contraponto padrão, texto do advogado mantido", () => {
    const r = merge({
      ...goodReview(),
      contraponto: "O Palmeiras vence em 90%, aposte.",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.narrative.counterpointSource).toBe("template");
    expect(r.narrative.counterpoint).toBe(templateCounterpoint(facts(), TEAMS));
    expect(r.narrative.sentences).toHaveLength(4);
  });

  it("contraponto que repete a frase sem_base → contraponto padrão", () => {
    const draft = goodDraft();
    const cut = draft.frases[2].texto;
    const r = merge(
      verdict(
        { ...goodReview(), contraponto: `É verdade que ${cut.toLowerCase()}` },
        2,
        "sem_base"
      ),
      draft
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.narrative.counterpointSource).toBe("template");
  });
});
