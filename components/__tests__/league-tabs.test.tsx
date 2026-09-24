import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LeagueTabs, visibleLeagueTabs } from "@/components/league-tabs";

describe("visibleLeagueTabs", () => {
  it("config pós-Copa (bsa+ucl): 'Todos' + Brasileirão + Champions, sem aba da Copa (#491)", () => {
    const tabs = visibleLeagueTabs(["bsa", "ucl"]);
    expect(tabs.map((t) => t.value)).toEqual(["all", "bsa", "ucl"]);
    expect(tabs.every((t) => t.active)).toBe(true);
  });

  it("usa a config real por default (ACTIVE_LEAGUE_KEYS)", () => {
    expect(visibleLeagueTabs().map((t) => t.value)).toEqual(["all", "bsa", "ucl"]);
  });

  it("não inclui a aba 'Todos' quando há só uma liga ativa", () => {
    const tabs = visibleLeagueTabs(["bsa"]);
    expect(tabs.some((t) => t.value === "all")).toBe(false);
  });

  it("liga de clube inativa aparece desabilitada; Copa inativa some", () => {
    const tabs = visibleLeagueTabs(["bsa"]);
    expect(tabs.map((t) => t.value)).toEqual(["bsa", "ucl"]);
    const byValue = Object.fromEntries(tabs.map((t) => [t.value, t.active]));
    expect(byValue.bsa).toBe(true);
    expect(byValue.ucl).toBe(false);
  });

  it("Copa ativa volta a aparecer (e clubes fora de temporada ficam desabilitados)", () => {
    const tabs = visibleLeagueTabs(["wc"]);
    expect(tabs.map((t) => t.value)).toEqual(["bsa", "ucl", "wc"]);
    const byValue = Object.fromEntries(tabs.map((t) => [t.value, t.active]));
    expect(byValue.wc).toBe(true);
    expect(byValue.bsa).toBe(false);
    expect(byValue.ucl).toBe(false);
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
  // elemento desabilitado. Derivar da config — em vez de hardcodar quais ligas
  // estão inativas — mantém o teste correto quando a config mudar (mudança de
  // uma linha em active-leagues.ts, que é justamente o design desta feature).
  it("renderiza cada liga ativa como link e cada liga inativa como elemento desabilitado", () => {
    const markup = renderToStaticMarkup(
      <LeagueTabs value="bsa" range={{ preset: "today5" }} />,
    );
    const leagueTabs = visibleLeagueTabs().filter((t) => t.value !== "all");

    for (const tab of leagueTabs) {
      if (tab.active) {
        // Liga ativa é um link real navegável (pra /jogos, a home authed).
        expect(markup).toContain(`href="/jogos?league=${tab.value}"`);
      } else {
        // Liga inativa NÃO é navegável: sem href pro seu filtro.
        expect(markup).not.toContain(`href="/jogos?league=${tab.value}"`);
      }
    }

    // Estado desabilitado comunicado a assistive tech quando há liga inativa.
    if (leagueTabs.some((t) => !t.active)) {
      expect(markup).toContain('aria-disabled="true"');
      // O detalhe da sazonalidade vive no sr-only (não só no `title`
      // inalcançável no touch/leitor de tela — #448).
      expect(markup).toContain("(fora de temporada — volta em agosto)");
    }

    // Ligas de clube sempre surfaçadas (#58); a Copa encerrada não (#491).
    expect(markup).toContain("Brasileirão");
    expect(markup).toContain("Champions");
    expect(markup).not.toContain("Copa do Mundo");
    expect(markup).not.toContain('href="/jogos?league=wc"');
  });

  it("aba 'Todos' aponta pra league=all explícito (não pra /jogos, que resolve pra liga default)", () => {
    const markup = renderToStaticMarkup(
      <LeagueTabs value="all" range={{ preset: "today5" }} />,
    );
    expect(markup).toContain('href="/jogos?league=all"');
    expect(markup).not.toContain('href="/jogos"');
  });

  it("preserva o range atual nos hrefs das ligas ativas (#98)", () => {
    const markup = renderToStaticMarkup(
      <LeagueTabs value="bsa" range={{ preset: "today14" }} />,
    );
    // Trocar de liga mantém o preset selecionado — os dois filtros compõem.
    expect(markup).toContain('href="/jogos?league=ucl&amp;preset=today14"');
    expect(markup).toContain('href="/jogos?league=all&amp;preset=today14"');
  });
});
