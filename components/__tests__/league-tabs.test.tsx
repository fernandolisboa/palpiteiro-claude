import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LeagueTabs, visibleLeagueTabs } from "@/components/league-tabs";

describe("visibleLeagueTabs", () => {
  it("retorna todas as ligas com a Copa ativa e Brasileirão/Champions inativos", () => {
    const tabs = visibleLeagueTabs(["wc"]);
    expect(tabs.map((t) => t.value)).toEqual(["bsa", "ucl", "wc"]);
    const byValue = Object.fromEntries(tabs.map((t) => [t.value, t.active]));
    expect(byValue.wc).toBe(true);
    expect(byValue.bsa).toBe(false);
    expect(byValue.ucl).toBe(false);
  });

  it("não inclui a aba 'Todos' quando há só uma liga ativa", () => {
    const tabs = visibleLeagueTabs(["wc"]);
    expect(tabs.some((t) => t.value === "all")).toBe(false);
  });

  it("inclui a aba 'Todos' (ativa) quando há mais de uma liga ativa e marca ambas as ligas como ativas", () => {
    const tabs = visibleLeagueTabs(["wc", "bsa"]);
    const all = tabs.find((t) => t.value === "all");
    expect(all).toBeDefined();
    expect(all?.active).toBe(true);
    const byValue = Object.fromEntries(tabs.map((t) => [t.value, t.active]));
    expect(byValue.wc).toBe(true);
    expect(byValue.bsa).toBe(true);
    expect(byValue.ucl).toBe(false);
  });
});

describe("LeagueTabs rendering (a11y)", () => {
  // Renderiza contra ACTIVE_LEAGUES real (wc ativa; bsa/ucl fora de temporada).
  it("renderiza liga inativa como elemento desabilitado e liga ativa como link", () => {
    const markup = renderToStaticMarkup(<LeagueTabs value="wc" />);

    // Liga ativa (Copa) é um link real navegável.
    expect(markup).toContain('href="/?league=wc"');

    // Liga inativa (Brasileirão/Champions) NÃO é navegável: sem href pra esse filtro.
    expect(markup).not.toContain('href="/?league=bsa"');
    expect(markup).not.toContain('href="/?league=ucl"');

    // Estado desabilitado comunicado a assistive tech.
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain("(fora de temporada)");

    // O label da liga inativa continua visível.
    expect(markup).toContain("Brasileirão");
  });
});
