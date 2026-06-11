import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ComoFuncionaContent } from "@/app/como-funciona/como-funciona-content";
import { GLOSSARY } from "@/components/help/glossary";

// Renderiza o CORPO síncrono (não a page async) — renderToStaticMarkup não
// aguarda Server Component async. Cobre smoke + o contrato de anchors que a
// issue de hints inline consome.
function render() {
  return renderToStaticMarkup(<ComoFuncionaContent />);
}

describe("ComoFuncionaContent", () => {
  it("renderiza sem sessão e sem lançar", () => {
    expect(() => render()).not.toThrow();
  });

  it("tem o H1 e os headings das seções", () => {
    const html = render();
    expect(html).toContain("Como funciona");
    expect(html).toContain("O que é over/under 2.5 (do zero)");
    expect(html).toContain("Como o app decide: edge, confiança e PASS");
    expect(html).toContain("Como ler os números (análise + dashboard)");
    expect(html).toContain("Glossário");
    expect(html).toContain("Jogo responsável");
  });

  it("contém o box do exemplo numérico ponta-a-ponta", () => {
    const html = render();
    expect(html).toContain("over 1.92 / under 1.92");
    expect(html).toContain("0.5208");
    expect(html).toContain("1.0417");
    expect(html).toContain("58%");
    expect(html).toContain("+8pp");
    expect(html).toContain("+0.1136 ≈ +11%");
  });

  it("carrega o bloco de jogo responsável (18+, CVV 188, disclaimer)", () => {
    const html = render();
    expect(html).toContain("18+");
    expect(html).toContain("Aposta não é investimento.");
    expect(html).toContain("188");
    expect(html).toContain(
      "Não é casa de apostas e não aceita dinheiro real.",
    );
  });

  it("renderiza todo anchor do glossário como id (contrato da issue de hints)", () => {
    const html = render();
    for (const { anchor } of GLOSSARY) {
      expect(html).toContain(`id="${anchor}"`);
    }
  });
});
