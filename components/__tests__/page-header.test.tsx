import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PAGE_CONTAINER_WIDTHS, PageContainer } from "@/components/page-container";
import { PageHeader, PageHeaderSkeleton } from "@/components/page-header";

describe("PageHeader (ADR 0056)", () => {
  it("renderiza um h1 só, com a escala de título", () => {
    const html = renderToStaticMarkup(<PageHeader title="Desempenho" />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Desempenho</h1>");
    expect(html).toContain("text-display-md");
    expect(html).toContain("lg:text-display-lg");
  });

  it("back renderiza o BackLink", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Bolão do sábado" back={{ href: "/bolao", label: "bolão" }} />,
    );
    expect(html).toContain('href="/bolao"');
    expect(html).toContain(">bolão</span>");
    expect(html).toContain("lucide-chevron-left");
  });

  it("descrição e meta em sans; meta com números alinhados", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Próximos jogos" description="texto" meta="12 partidas" />,
    );
    expect(html).toContain("text-body");
    expect(html).toContain("tabular-nums");
    expect(html).not.toContain("font-mono");
  });

  it("actions aparece ao lado do título", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Próximos jogos" actions={<button>filtro</button>} />,
    );
    expect(html).toContain("<button>filtro</button>");
    expect(html).toContain("lg:justify-between");
  });

  it("o esqueleto sem título não tem h1; com título tem", () => {
    expect(renderToStaticMarkup(<PageHeaderSkeleton back meta />)).not.toContain("<h1");
    expect(renderToStaticMarkup(<PageHeaderSkeleton title="Bolão" />)).toContain(
      ">Bolão</h1>",
    );
  });
});

describe("PageContainer", () => {
  it("três larguras e o mesmo gutter", () => {
    const content = renderToStaticMarkup(<PageContainer width="content">x</PageContainer>);
    const reading = renderToStaticMarkup(<PageContainer width="reading">x</PageContainer>);
    const wide = renderToStaticMarkup(<PageContainer width="wide">x</PageContainer>);
    expect(content).toContain("max-w-content");
    expect(reading).toContain("max-w-reading");
    expect(wide).toContain("max-w-wide");
    for (const html of [content, reading, wide]) {
      expect(html).toContain("px-5");
      expect(html).toContain("lg:px-8");
    }
  });

  it("marca a largura no markup, pro rodapé seguir a coluna (ADR 0059)", () => {
    const content = renderToStaticMarkup(<PageContainer width="content">x</PageContainer>);
    const reading = renderToStaticMarkup(<PageContainer width="reading">x</PageContainer>);
    expect(content).toContain('data-page-width="content"');
    expect(reading).toContain('data-page-width="reading"');
    const wide = renderToStaticMarkup(<PageContainer width="wide">x</PageContainer>);
    expect(wide).toContain('data-page-width="wide"');
  });

  // Uma largura nova sem o token no @theme vira `max-w-<nome>` sem CSS nenhum (o
  // Tailwind v4 só gera a utility a partir de `--container-<nome>`).
  it("toda largura tem o token --container-<nome> no app/globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    for (const [name, cls] of Object.entries(PAGE_CONTAINER_WIDTHS)) {
      expect(cls).toBe(`max-w-${name}`);
      expect(css, name).toMatch(new RegExp(`--container-${name}:\\s*\\d+px;`));
    }
  });
});
