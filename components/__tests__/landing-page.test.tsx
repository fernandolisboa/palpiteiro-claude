import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingContent } from "@/app/landing-content";

// Renderiza o CORPO síncrono (não a page) — renderToStaticMarkup não aguarda
// Server Component async. Asserções são ESTRUTURAIS (href/elemento/disclaimer),
// nunca a frase de marketing: a copy é "real-porém-revisável" pelo dono, então
// fixar a sentença quebraria o teste a cada edição de wording (R7).
function render() {
  return renderToStaticMarkup(<LandingContent />);
}

describe("LandingContent", () => {
  it("renderiza sem sessão e sem lançar", () => {
    expect(() => render()).not.toThrow();
  });

  it("tem um H1", () => {
    const html = render();
    expect(html).toMatch(/<h1[\s>]/);
  });

  it("traz o CTA primário pra /signin", () => {
    const html = render();
    expect(html).toContain('href="/signin"');
  });

  it("linka pra /como-funciona", () => {
    const html = render();
    expect(html).toContain('href="/como-funciona"');
  });

  it("carrega o disclaimer 18+ / jogo responsável (firewall regulatório)", () => {
    const html = render();
    expect(html).toContain("18+");
    expect(html).toContain("Não é casa de apostas");
  });

  it("não vaza chrome autenticado nem rota gateada da home", () => {
    const html = render();
    // A landing é pública: nenhum link pra rotas gateadas nem pra home authed.
    expect(html).not.toContain('href="/jogos"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).not.toContain('href="/perfil"');
    expect(html).not.toContain('href="/admin"');
  });
});
