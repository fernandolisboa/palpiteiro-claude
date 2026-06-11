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
  // Derivado da config real de ACTIVE_LEAGUES via visibleLeagueTabs() (a mesma
  // fonte que o componente usa): cada liga ativa vira link, cada inativa vira
  // elemento desabilitado. Derivar da config — em vez de hardcodar bsa/ucl como
  // inativas — mantém o teste correto mesmo após reativar uma liga (mudança de
  // uma linha em active-leagues.ts, que é justamente o design desta feature).
  it("renderiza cada liga ativa como link e cada liga inativa como elemento desabilitado", () => {
    const markup = renderToStaticMarkup(
      <LeagueTabs value="wc" range={{ preset: "today5" }} />,
    );
    const leagueTabs = visibleLeagueTabs().filter((t) => t.value !== "all");

    for (const tab of leagueTabs) {
      if (tab.active) {
        // Liga ativa é um link real navegável.
        expect(markup).toContain(`href="/?league=${tab.value}"`);
      } else {
        // Liga inativa NÃO é navegável: sem href pro seu filtro.
        expect(markup).not.toContain(`href="/?league=${tab.value}"`);
      }
    }

    // Estado desabilitado comunicado a assistive tech quando há liga inativa
    // (verdadeiro na config atual da Copa).
    if (leagueTabs.some((t) => !t.active)) {
      expect(markup).toContain('aria-disabled="true"');
      expect(markup).toContain("(fora de temporada)");
    }

    // #58 (núcleo): toda liga suportada é surfaçada — ativa ou desabilitada.
    expect(markup).toContain("Brasileirão");
    expect(markup).toContain("Champions");
    expect(markup).toContain("Copa do Mundo");
  });

  it("preserva o range atual nos hrefs das ligas ativas (#98)", () => {
    const markup = renderToStaticMarkup(
      <LeagueTabs value="wc" range={{ preset: "today14" }} />,
    );
    // Trocar de liga mantém o preset selecionado — os dois filtros compõem.
    expect(markup).toContain("href=\"/?league=wc&amp;preset=today14\"");
  });
});
