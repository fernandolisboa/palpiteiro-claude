import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchTabs } from "@/components/match-tabs";
import { TOUR_TAB_EVENT } from "@/lib/tour/steps";
import type { MatchTab } from "@/lib/view/match-tabs";

const slots = {
  mercados: <p>tabela</p>,
  seuPalpite: <p>seu palpite aqui</p>,
  dados: <p>forma e h2h</p>,
};

const panel = (root: ParentNode, tour: string) =>
  root.querySelector<HTMLElement>(`[data-tour="${tour}"]`)!;

describe("MatchTabs — SSR", () => {
  it.each([
    ["mercados", "mercados"],
    ["seu-palpite", "seu-palpite"],
    ["dados", "match-stats"],
  ] as const)("initialTab=%s: só esse painel sem hidden, os três montados", (tab, tour) => {
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(<MatchTabs initialTab={tab as MatchTab} {...slots} />);
    for (const t of ["mercados", "seu-palpite", "match-stats"]) {
      expect(panel(div, t).hasAttribute("hidden"), t).toBe(t !== tour);
      expect(panel(div, t).getAttribute("role")).toBe("tabpanel");
    }
    // Conteúdo de todas as abas no DOM (estado preservado, alvos do tour).
    expect(div.textContent).toContain("tabela");
    expect(div.textContent).toContain("seu palpite aqui");
    expect(div.textContent).toContain("forma e h2h");
    const selected = div.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe(
      { mercados: "Mercados", "seu-palpite": "Seu palpite", dados: "Dados" }[tab],
    );
  });
});

describe("MatchTabs — troca", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", "/match/1?back=%2Fjogos%3Fliga%3Dbra");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const tab = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (b) => b.textContent === label,
    )!;

  // O Radix ativa a aba no mousedown (botão 0, sem ctrl), não no click.
  const press = (el: HTMLElement) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

  it("troca de aba com replaceState em ?aba=, preservando back; Mercados limpa o param", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    await act(async () => root.render(<MatchTabs initialTab="mercados" {...slots} />));
    await press(tab("Dados"));
    expect(panel(container, "match-stats").hidden).toBe(false);
    expect(panel(container, "mercados").hidden).toBe(true);
    expect(replace).toHaveBeenCalled();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("aba")).toBe("dados");
    expect(url.searchParams.get("back")).toBe("/jogos?liga=bra");
    await press(tab("Mercados"));
    expect(new URL(window.location.href).searchParams.has("aba")).toBe(false);
    expect(new URL(window.location.href).searchParams.get("back")).toBe("/jogos?liga=bra");
  });

  it("setas movem o foco e ativam a aba (activationMode automático)", async () => {
    await act(async () => root.render(<MatchTabs initialTab="mercados" {...slots} />));
    const first = tab("Mercados");
    await act(async () => first.focus());
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      // O foco itinerante do Radix move o foco num setTimeout.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(tab("Seu palpite"));
    expect(tab("Seu palpite").getAttribute("aria-selected")).toBe("true");
    expect(panel(container, "seu-palpite").hidden).toBe(false);
    // Só a aba ativa entra no Tab (foco itinerante).
    expect(tab("Seu palpite").tabIndex).toBe(0);
    expect(tab("Mercados").tabIndex).toBe(-1);
  });

  it("evento do tour troca a aba já no dispatch (flushSync) e grava na URL", async () => {
    await act(async () => root.render(<MatchTabs initialTab="mercados" {...slots} />));
    let visibleRightAfter: boolean | null = null;
    await act(async () => {
      window.dispatchEvent(new CustomEvent(TOUR_TAB_EVENT, { detail: "dados" }));
      // O tour procura o alvo logo depois do dispatch: o painel já tem de estar visível.
      visibleRightAfter = !panel(container, "match-stats").hidden;
    });
    expect(visibleRightAfter).toBe(true);
    expect(panel(container, "mercados").hidden).toBe(true);
    expect(new URL(window.location.href).searchParams.get("aba")).toBe("dados");
  });

  it("evento do tour com aba desconhecida é ignorado", async () => {
    await act(async () => root.render(<MatchTabs initialTab="seu-palpite" {...slots} />));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(TOUR_TAB_EVENT, { detail: "lixo" }));
    });
    expect(panel(container, "seu-palpite").hidden).toBe(false);
  });
});
