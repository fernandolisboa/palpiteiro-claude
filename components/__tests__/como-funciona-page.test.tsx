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
    expect(html).toContain("Os outros mercados");
    expect(html).toContain("Como ler os números (análise + dashboard)");
    expect(html).toContain("Glossário");
    expect(html).toContain("Jogo responsável");
  });

  it("contém o box do exemplo numérico ponta-a-ponta (over/under)", () => {
    const html = render();
    expect(html).toContain("over 1.92 / under 1.92");
    expect(html).toContain("0.5208");
    expect(html).toContain("1.0417");
    expect(html).toContain("58%");
    expect(html).toContain("+8pp");
    expect(html).toContain("+0.1136 ≈ +11%");
  });

  it("tem uma seção de ajuda por mercado ativo, com âncora linkável", () => {
    const html = render();
    // Headings das seções de cada mercado (over/under é a seção "do zero" acima).
    expect(html).toContain("Resultado final: 1X2");
    expect(html).toContain("Ambas marcam (BTTS)");
    expect(html).toContain("Dupla chance");
    // Cada mercado expõe um id estável pra deep-link (AC: âncora linkável).
    for (const id of [
      "mercado-over-under",
      "mercado-1x2",
      "mercado-btts",
      "mercado-dupla-chance",
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  it("traz o exemplo numérico 3-vias (1X2) com edge por seleção", () => {
    const html = render();
    expect(html).toContain("casa 2.10 / empate 3.40 / fora 3.60");
    expect(html).toContain("1.0481"); // soma das 3 cruas (overround sobre N=3)
    expect(html).toContain("45,43%"); // implícita normalizada da casa
    expect(html).toContain("+6,57pp"); // edge da casa (clears MIN_EDGE_PP)
    expect(html).toContain("+0.092 ≈ +9%"); // retorno esperado na odd crua
  });

  it("traz exemplos numéricos de BTTS (N=2) e dupla chance (par, PASS)", () => {
    const html = render();
    // BTTS: mecânica binária, recomenda sim.
    expect(html).toContain("sim 1.80 / não 2.00");
    expect(html).toContain("+7,37pp");
    // Dupla chance: implícitas somam ~200%, todos os edges abaixo do mínimo → PASS.
    expect(html).toContain("2.0692");
    expect(html).toContain("+1,68pp");
  });

  it("sinaliza que BTTS e dupla chance hoje só valem na Copa do Mundo", () => {
    const html = render();
    const occurrences = html.split("só em jogos de Copa do Mundo").length - 1;
    expect(occurrences).toBe(2);
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
