// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingContent } from "@/app/landing-content";
import { POOL_MONEY_NOTE } from "@/lib/view/friend-pool";

// Renderiza o CORPO síncrono (não a page) — renderToStaticMarkup não aguarda
// Server Component async. Asserções são ESTRUTURAIS (href/elemento/firewall),
// nunca a frase de marketing: a copy é "real-porém-revisável" pelo dono, então
// fixar a sentença quebraria o teste a cada edição de wording.
function render() {
  return renderToStaticMarkup(<LandingContent />);
}

// Texto visível sem tags (e sem entidades), pra varredura de vocabulário.
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("LandingContent", () => {
  it("renderiza sem sessão e sem lançar", () => {
    expect(() => render()).not.toThrow();
  });

  it("tem um H1 só", () => {
    expect(render().match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("traz o CTA primário pra /signin e linka /como-funciona", () => {
    const html = render();
    expect(html).toContain('href="/signin"');
    expect(html).toContain('href="/como-funciona"');
  });

  it("três blocos (Palpite da IA, Suas apostas, Bolão), cada um com a ilustração rotulada", () => {
    const html = render();
    const sections = html.split("<section").slice(1);
    const blocks = sections.filter((s) => s.includes("<figure"));
    expect(blocks).toHaveLength(3);
    for (const [i, title] of ["Palpite da IA", "Suas apostas", "Bolão"].entries()) {
      const block = blocks[i];
      expect(block).toMatch(new RegExp(`<h2[^>]*>${title}</h2>`));
      expect(block).toMatch(/<div aria-hidden="true" inert=""/);
      expect(block).toContain("Exemplo ilustrativo");
    }
  });

  it("o bloco do bolão diz que o app não mexe em dinheiro (fato do produto, ADR 0054)", () => {
    expect(render()).toContain(POOL_MONEY_NOTE);
  });

  it("um aviso só: o rodapé global carrega o 18+ e o 'não é casa de apostas'", () => {
    // Travado em components/__tests__/site-footer.test.tsx (ADR 0059).
    const html = render();
    expect(html).not.toContain("18+");
    expect(html).not.toContain("Não é casa de apostas");
    expect(html).not.toContain("Aposta não é investimento");
  });

  it("firewall: sem odd, vantagem, stake, R$, %, valor em u (\"2u\") nem promessa", () => {
    expect(text(render())).not.toMatch(
      /\bodds?\b|vantagem|\bedge\b|stake|R\$|%|\b\d+(,\d+)?u\b|lucro|garant|ganhe/i,
    );
  });

  it("o palpite é sob demanda: nada de 'cada jogo' (R6)", () => {
    expect(text(render())).not.toMatch(/cada jogo/i);
  });

  it("nada externo: nenhum <img>", () => {
    expect(render()).not.toContain("<img");
  });

  it("não vaza chrome autenticado nem rota gateada da home", () => {
    const html = render();
    // A landing é pública: nenhum link pra rotas gateadas nem pra home authed.
    expect(html).not.toContain('href="/jogos"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).not.toContain('href="/perfil"');
    expect(html).not.toContain('href="/admin"');
  });

  it("sem JS de cliente novo: nenhum 'use client' no corpo nem nas ilustrações", () => {
    const files = [
      "app/landing-content.tsx",
      ...readdirSync(join(ROOT, "components/landing")).map((f) => `components/landing/${f}`),
    ];
    for (const f of files) expect(read(f), f).not.toMatch(/^["']use client["']/m);
  });

  it("a page continua force-static", () => {
    expect(read("app/page.tsx")).toContain('export const dynamic = "force-static"');
  });
});
