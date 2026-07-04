import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import PrivacidadePage from "@/app/privacidade/page";
import TermosPage from "@/app/termos/page";

// Páginas legais estáticas (docs/ops/05-legal-compliance.md §4/§5). As asserções fixam
// os INVARIANTES LEGAIS (itens obrigatórios que não podem sumir silenciosamente numa
// edição de wording) — não a redação exata. Conteúdo forward-only: a data de "Última
// atualização" e o texto são revisáveis pelo dono; o teste só garante que os pilares
// (18+, não-operador, controlador, sub-operadores, cross-links, contato) seguem presentes.

describe("/termos", () => {
  const html = renderToStaticMarkup(<TermosPage />);

  it("renderiza sem lançar e tem H1", () => {
    expect(html).toMatch(/<h1[\s>]/);
  });

  it("carimba a versão (forward-only)", () => {
    expect(html).toContain("Última atualização");
  });

  it("afirma 18+ e o posicionamento não-operador", () => {
    expect(html).toContain("18 anos");
    expect(html).toContain("não é uma casa de apostas");
  });

  it("cruza pra /privacidade e traz o contato do controlador", () => {
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain("contato@palpiteiro.live");
  });
});

describe("/privacidade", () => {
  const html = renderToStaticMarkup(<PrivacidadePage />);

  it("renderiza sem lançar e tem H1", () => {
    expect(html).toMatch(/<h1[\s>]/);
  });

  it("carimba a versão (forward-only)", () => {
    expect(html).toContain("Última atualização");
    expect(html).toContain("LGPD");
  });

  it("lista os sub-operadores que o código realmente usa (transparência LGPD)", () => {
    for (const proc of ["Vercel", "Neon", "Resend", "Anthropic", "Upstash", "Sentry"]) {
      expect(html).toContain(proc);
    }
  });

  it("cobre o direito de exclusão, o contato e o cross-link pros Termos", () => {
    expect(html).toContain("exclusão");
    expect(html).toContain("contato@palpiteiro.live");
    expect(html).toContain('href="/termos"');
  });
});
