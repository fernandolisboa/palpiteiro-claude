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

  // Report 11 / ADRs 0040-0041: aceite explícito, sem vínculo com casa, limitação de
  // responsabilidade que não afasta direitos irrenunciáveis, lei/foro.
  it("registra o aceite, o não-vínculo com casas e os limites legais", () => {
    expect(html).toContain("aceita estes Termos");
    expect(html).toContain("Sem vínculo com casas de apostas");
    expect(html).toContain(".bet.br");
    expect(html).toContain("Nada nestes Termos afasta direitos");
    expect(html).toContain("foro do seu domicílio");
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

  // Report 11 / ADRs 0039-0040: art. 9º (finalidade + base legal + direitos do art. 18),
  // art. 33 (transferência), Res. CD/ANPD 2/2022 art. 11 (canal sem encarregado),
  // prazo de resposta e o que a exclusão apaga vs. anonimiza.
  it("traz base legal por finalidade, transferência, encarregado e prazos", () => {
    expect(html).toContain("art. 7º, V");
    expect(html).toContain("art. 7º, IX");
    expect(html).toContain("art. 33, IX");
    expect(html).toContain("Resolução CD/ANPD nº 2/2022");
    expect(html).toContain("art. 18");
    expect(html).toContain("15 dias");
    expect(html).toContain("anonimizados");
    expect(html).toContain("ANPD");
  });

  it("não se apoia em consentimento como base do serviço (ADR 0040)", () => {
    expect(html).toContain("Não usamos o consentimento como base");
  });
});
