import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HelpHint, isGlossaryAnchor } from "@/components/help-hint";
import { GLOSSARY } from "@/components/help/glossary";

// O conteúdo do Popover é PORTALADO (ADR 0014, mesma pegadinha do Sheet): em
// markup fechado só o trigger existe. Os asserts de markup miram o `?`; o blurb
// e o link "saiba mais" vivem no portal e não aparecem aqui.
describe("HelpHint — trigger acessível", () => {
  it("renderiza um <button> '?' com o aria-label esperado", () => {
    const markup = renderToStaticMarkup(
      <HelpHint
        anchor="yield"
        label="yield"
        blurb="lucro ÷ total apostado"
      />,
    );
    expect(markup).toContain("<button");
    expect(markup).toContain('aria-label="Ajuda: yield"');
    expect(markup).toContain(">?<");
  });

  it("o trigger é focável e tem anel de foco (a11y de teclado)", () => {
    const markup = renderToStaticMarkup(
      <HelpHint anchor="edge" label="edge" blurb="vantagem sobre o mercado" />,
    );
    // <button> nativo: focável por padrão, sem tabindex negativo.
    expect(markup).not.toContain('tabindex="-1"');
    expect(markup).toContain("focus-visible:ring");
  });

  it("não emite nenhuma classe das famílias reservadas accent-/edge-", () => {
    const markup = renderToStaticMarkup(
      <HelpHint anchor="edge" label="edge" blurb="qualquer coisa" />,
    );
    expect(markup).not.toContain("accent-");
    expect(markup).not.toContain("edge-");
  });
});

describe("HelpHint — contrato dos anchors", () => {
  it("isGlossaryAnchor reconhece membros reais e rejeita desconhecidos", () => {
    expect(isGlossaryAnchor("yield")).toBe(true);
    expect(isGlossaryAnchor("anchor-que-nao-existe")).toBe(false);
  });

  // Mapa SEMÂNTICO por placement (não só "existe"): um typo OU um mapeamento
  // pro conjunto errado (ex.: lucro total → #yield) falha aqui.
  const PLACEMENT_ANCHORS: Record<string, string> = {
    yield: "yield",
    "win rate": "win-rate",
    "pass rate": "pass-rate",
    "lucro total": "lucro-total",
    "prob. do modelo": "prob-modelo",
    "prob. do mercado": "prob-implicita",
    edge: "edge",
    "retorno esperado": "retorno-esperado",
    overround: "overround",
    normalizada: "prob-implicita",
    PASS: "recomendacao",
    "odd mínima": "odd-minima",
    "amostra pequena": "amostra-pequena",
  };

  it("todo anchor referenciado por um placement existe em GLOSSARY", () => {
    for (const anchor of Object.values(PLACEMENT_ANCHORS)) {
      expect(
        GLOSSARY.some((e) => e.anchor === anchor),
        `anchor "${anchor}" não existe em GLOSSARY`,
      ).toBe(true);
    }
  });

  it("os anchors de conjuntos distintos não colidem (lucro-total ≠ yield)", () => {
    expect(PLACEMENT_ANCHORS["lucro total"]).toBe("lucro-total");
    expect(PLACEMENT_ANCHORS["yield"]).toBe("yield");
    expect(PLACEMENT_ANCHORS["lucro total"]).not.toBe(
      PLACEMENT_ANCHORS["yield"],
    );
  });
});
