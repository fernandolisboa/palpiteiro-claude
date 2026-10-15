import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { SiteFooter } from "@/components/site-footer";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/controller";

// O rodapé global é a trava legal das telas públicas (ADR 0048 D4, ADR 0059): a landing
// não tem aviso próprio, então o 18+, a frase de jogo responsável, os canais de ajuda e
// o "não é casa de apostas" têm de sair daqui em toda rota (menos o /p).
function render(path = "/") {
  pathname.current = path;
  return renderToStaticMarkup(<SiteFooter />);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => {
  pathname.current = "/";
});

describe("SiteFooter", () => {
  it("carrega os avisos obrigatórios e os links legais", () => {
    const html = render();
    expect(html).toContain("18+");
    expect(html).toContain("Aposte com responsabilidade. Aposta não é investimento.");
    expect(html).toContain("Não é casa de apostas e não aceita");
    expect(html).toContain("dinheiro real.");
    expect(html).toContain("CVV 188");
    expect(html).toContain("Jogadores Anônimos");
    expect(html).toContain('href="/termos"');
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain(`href="mailto:${LEGAL_CONTACT_EMAIL}"`);
  });

  it("a coluna tem a geometria do PageContainer e a marca lida pelo CSS", () => {
    const html = render();
    const column = html.match(/<div data-footer-column="[^"]*" class="([^"]+)"/);
    expect(column).not.toBeNull();
    const classes = column![1].split(/\s+/);
    for (const cls of ["mx-auto", "w-full", "max-w-content", "px-5", "lg:px-8"]) {
      expect(classes).toContain(cls);
    }
    // O gutter mora na coluna, não no <footer> (senão somaria dois gutters).
    expect(html).not.toMatch(/<footer[^>]*\bpx-6\b/);
  });

  it("some no /p (o snapshot compartilhado tem os próprios avisos)", () => {
    expect(render("/p")).toBe("");
    expect(render("/p/abc")).toBe("");
  });
});

describe("rodapé na largura da página (guarda de fonte, ADR 0059)", () => {
  const css = read("app/globals.css");
  const reading = css.indexOf('body:has([data-page-width="reading"]) [data-footer-column]');
  const form = css.indexOf('body:has([data-page-width="form"]) [data-footer-column]');

  it("as regras de reading e form existem, com form por último", () => {
    expect(reading).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(reading);
  });

  it("toda var(--container-…) tem fallback literal e não há content-box", () => {
    const rules = css.slice(reading, css.indexOf("}", css.lastIndexOf("[data-footer-column]")) + 1);
    const vars = rules.match(/var\(--container-[a-z]+[^)]*\)/g) ?? [];
    expect(vars.length).toBeGreaterThanOrEqual(3);
    for (const v of vars) expect(v).toMatch(/var\(--container-[a-z]+, \d+px\)/);
    expect(css).not.toContain("content-box");
  });

  it("as páginas sem PageContainer marcam a largura à mão", () => {
    expect(read("app/signin/page.tsx")).toContain('data-page-width="form"');
    expect(read("app/termos/page.tsx")).toContain('data-page-width="reading"');
    expect(read("app/privacidade/page.tsx")).toContain('data-page-width="reading"');
  });
});
