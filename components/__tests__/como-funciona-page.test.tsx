import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COMO_FUNCIONA_SECTIONS,
  ComoFuncionaContent,
} from "@/app/como-funciona/como-funciona-content";
import { GLOSSARY } from "@/components/help/glossary";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { POOL_MONEY_NOTE } from "@/lib/view/friend-pool";

// Renderiza o CORPO síncrono (não a page async) — renderToStaticMarkup não
// aguarda Server Component async. Cobre smoke, o índice, os exemplos numéricos,
// o vocabulário de tela (ADR 0056) e o contrato de anchors que os HelpHint consomem.
function render() {
  return renderToStaticMarkup(<ComoFuncionaContent />);
}

// Texto visível sem tags, pra varredura de vocabulário.
function text(html: string) {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

// O corpo até o glossário (o glossário mostra o apelido em inglês no termo).
function bodyBeforeGlossary(html: string) {
  return html.slice(0, html.indexOf('id="glossario"'));
}

describe("ComoFuncionaContent", () => {
  it("renderiza sem sessão e sem lançar", () => {
    expect(() => render()).not.toThrow();
  });

  it("tem o H1 e um heading por seção", () => {
    const html = render();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(">Como funciona</h1>");
    for (const title of [
      "Palpite da IA",
      "Como a IA lê o jogo",
      "Os mercados",
      "Vantagem e sem aposta",
      "Suas apostas",
      "Bolão",
      "Seus números",
      "Glossário",
      "Jogo responsável",
    ]) {
      expect(html, title).toMatch(new RegExp(`<h2[^>]*>${title}</h2>`));
    }
  });

  it("o índice leva a cada seção da página", () => {
    const html = render();
    const nav = html.slice(
      html.indexOf('<nav aria-label="Nesta página"'),
      html.indexOf("</nav>"),
    );
    const targets = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toEqual(COMO_FUNCIONA_SECTIONS.map((s) => s.id));
    for (const id of targets) expect(html, id).toContain(`id="${id}"`);
  });

  it("ids de seção não colidem com anchors do glossário", () => {
    const anchors = new Set(GLOSSARY.map((e) => e.anchor));
    for (const { id } of COMO_FUNCIONA_SECTIONS) expect(anchors.has(id), id).toBe(false);
  });

  it("mantém os ids que outras telas linkam (mercados e o-palpite)", () => {
    const html = render();
    for (const id of [
      "mercado-over-under",
      "mercado-1x2",
      "mercado-btts",
      "mercado-dupla-chance",
      "o-palpite",
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain("Total de gols");
    expect(html).toContain("Resultado (1X2)");
    expect(html).toContain("Ambas marcam");
    expect(html).toContain("Dupla chance");
  });

  it("não diz mais que BTTS e dupla chance estão indisponíveis (cobertura vem do banco)", () => {
    const html = render();
    expect(html).not.toContain("Temporariamente indisponível");
    expect(html).toContain("Nem todo jogo tem odds de todos os mercados");
  });

  it("explica o Dixon-Coles, Suas apostas e o bolão", () => {
    const html = render();
    expect(html).toContain("Dixon-Coles");
    expect(html).toContain('id="suas-apostas"');
    expect(html).toContain('id="bolao"');
    const bolao = html.slice(html.indexOf('id="bolao"'), html.indexOf('id="seus-numeros"'));
    expect(bolao).toContain(POOL_MONEY_NOTE);
    // R7: o horário de fechamento muda com o #580; a página não fixa nenhum.
    expect(html).not.toContain("apito inicial");
  });

  it("as contas ficam recolhidas: exatamente 4 'ver a conta', todos fechados", () => {
    const html = render();
    expect(html.match(/<details[\s>]/g)).toHaveLength(4);
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)];
    expect(summaries).toHaveLength(4);
    for (const [, inner] of summaries) expect(text(inner)).toContain("ver a conta");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("exemplo ponta a ponta do total de gols, com vírgula decimal e pontos", () => {
    const html = render();
    expect(html).toContain("mais de 1,92 / menos de 1,92");
    expect(html).toContain("0,5208");
    expect(html).toContain("1,0417");
    expect(html).toContain("58%");
    expect(html).toContain("+8 pontos");
    expect(html).toContain("+0,1136 ≈ +11%");
    expect(html).toContain(`${MIN_EDGE_PP} pontos`);
  });

  it("exemplos de resultado (3 seleções), ambas marcam e dupla chance", () => {
    const html = render();
    expect(html).toContain("mandante 2,10 / empate 3,40 / visitante 3,60");
    expect(html).toContain("1,0481");
    expect(html).toContain("45,43%");
    expect(html).toContain("+6,57 pontos");
    expect(html).toContain("+0,092 ≈ +9%");
    expect(html).toContain("sim 1,80 / não 2,00");
    expect(html).toContain("+7,37 pontos");
    expect(html).toContain("+0,08 ≈ +8%");
    expect(html).toContain("2,0692");
    expect(html).toContain("+1,68 pontos");
  });

  it("vocabulário de tela no corpo (ADR 0056): sem jargão do motor até o glossário", () => {
    const body = text(bodyBeforeGlossary(render()));
    expect(body).not.toMatch(
      /\bPASS\b|\byield\b|win rate|pass rate|\d+pp\b|\bover\b|\bunder\b|\bedge\b|\bTier\b/i,
    );
    // Vírgula decimal nos exemplos (nenhum "1.92").
    expect(body).not.toMatch(/\d\.\d/);
  });

  it("sem número de desempenho em página pública (ADR 0048 D4)", () => {
    const body = text(render());
    expect(body).not.toMatch(/taxa de acerto de \d|\d+% de acerto/);
    expect(body).toContain("Resultado passado não garante resultado futuro.");
  });

  it("carrega o bloco de jogo responsável (18+, CVV 188, disclaimer)", () => {
    const html = render();
    expect(html).toContain('id="jogo-responsavel"');
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
