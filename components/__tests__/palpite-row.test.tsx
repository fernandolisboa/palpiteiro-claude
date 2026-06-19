import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PalpiteRow } from "@/components/palpites/palpite-row";
import { PreviousPalpites } from "@/components/palpites/previous-palpites";
import type { PalpiteLineView, PalpiteSetView } from "@/lib/view/palpites";

function lineWith(state: PalpiteLineView["state"], over: Partial<PalpiteLineView> = {}): PalpiteLineView {
  return {
    id: "l1",
    type: "exact_score",
    typeLabel: "placar exato",
    text: "2 a 1 pro mandante",
    state,
    ...over,
  };
}

// Smoke-test do render por estado (PLAN §5): a derivação vive no mapper (testada em
// lib/view/__tests__/palpites.test.ts); aqui garantimos que cada `state.kind` pinta
// a palavra+token corretos — settleable honesty E a11y (palavra, não só cor).
describe("PalpiteRow — render por estado", () => {
  it("fun → tag 'só por diversão', SEM acertou/errou/aguardando", () => {
    const html = renderToStaticMarkup(
      <PalpiteRow line={lineWith({ kind: "fun" }, { type: "red_card", typeLabel: "cartão vermelho" })} />,
    );
    expect(html).toContain("só por diversão");
    expect(html).toContain("cartão vermelho");
    expect(html).not.toContain("acertou");
    expect(html).not.toContain("errou");
    expect(html).not.toContain("aguardando");
  });

  it("pending → 'aguardando placar' (neutro), SEM acertou/errou", () => {
    const html = renderToStaticMarkup(<PalpiteRow line={lineWith({ kind: "pending" })} />);
    expect(html).toContain("aguardando placar");
    expect(html).not.toContain("acertou");
    expect(html).not.toContain("errou");
  });

  it("settled won → 'acertou' + token form-win", () => {
    const html = renderToStaticMarkup(
      <PalpiteRow line={lineWith({ kind: "settled", result: "won" })} />,
    );
    expect(html).toContain("acertou");
    expect(html).toContain("form-win");
    expect(html).not.toContain("errou");
  });

  it("settled lost → 'errou' + token form-loss", () => {
    const html = renderToStaticMarkup(
      <PalpiteRow line={lineWith({ kind: "settled", result: "lost" })} />,
    );
    expect(html).toContain("errou");
    expect(html).toContain("form-loss");
  });
});

// PreviousPalpites: lista PLANA sempre-visível (PLAN §0.2) — sem chevron/details/
// estado open/close. Guard de regressão pra não voltar a colapsar.
describe("PreviousPalpites — lista PLANA (não colapsável)", () => {
  function setWith(id: string): PalpiteSetView {
    return {
      id,
      generatedAt: new Date("2026-06-01T12:00:00Z"),
      lines: [lineWith({ kind: "fun" }, { id: `${id}-l`, type: "corners", typeLabel: "escanteios" })],
    };
  }

  it("vazio → não renderiza nada", () => {
    expect(renderToStaticMarkup(<PreviousPalpites sets={[]} />)).toBe("");
  });

  it("com sets → 'palpites anteriores', SEM affordance de colapso", () => {
    const html = renderToStaticMarkup(<PreviousPalpites sets={[setWith("a"), setWith("b")]} />);
    expect(html).toContain("palpites anteriores");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("data-state");
  });
});
