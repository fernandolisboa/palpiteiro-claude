import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PalpiteProgress } from "@/components/palpites/palpite-progress";
import { StepIcon } from "@/components/palpites/step-icon";

const props = {
  title: "Analisando",
  hint: "Leva uns segundos",
  steps: [{ id: "model", status: "active" as const, label: "Calculando as chances" }],
  waitingLabel: "Começando",
};

// Personagem ao lado do progresso (ADR 0068, flag `progressMascot` do /admin/ia).
describe("PalpiteProgress: personagem", () => {
  it("padrão é o robozinho", () => {
    const html = renderToStaticMarkup(<PalpiteProgress {...props} />);
    expect(html).toContain('data-testid="palpite-bot"');
    expect(html).not.toContain('data-testid="parrot-mascot"');
  });

  it("com a flag em papagaio, mostra o papagaio no lugar do robô", () => {
    const html = renderToStaticMarkup(<PalpiteProgress {...props} mascot="papagaio" />);
    expect(html).toContain('data-testid="parrot-mascot"');
    expect(html).not.toContain('data-testid="palpite-bot"');
  });
});

describe("StepIcon: etapa em andamento", () => {
  it("o spinner leva `palpite-spin` (gira mesmo com movimento reduzido) e não é desligado", () => {
    const html = renderToStaticMarkup(<StepIcon status="active" />);
    expect(html).toContain("palpite-spin");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("motion-reduce:animate-none");
  });
});
