import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/tour", () => ({
  saveTourState: vi.fn(async () => ({ ok: true })),
}));

import { saveTourState } from "@/app/actions/tour";
import { GuidedTour } from "@/components/tour/guided-tour";
import type { TourChapter, TourState } from "@/lib/tour/steps";

// jsdom não faz layout: sem estes stubs nenhum alvo "aparece" e o tour pularia tudo.
class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    // "Visível" = não marcado como escondido (simula a árvore mobile/desktop).
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
  });
  window.localStorage.clear();
  vi.mocked(saveTourState).mockClear();

  document.body.innerHTML = `
    <button data-tour="menu">menu</button>
    <div data-tour="league-picker">liga</div>
    <div data-tour="date-range" hidden>período escondido</div>
    <div data-tour="date-range">período</div>
    <a data-tour="match-row" href="/match/1">jogo</a>
  `;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(props: {
  chapter?: TourChapter;
  serverState?: TourState | null;
  forceStart?: boolean;
}) {
  act(() => {
    root.render(
      <GuidedTour
        chapter={props.chapter ?? "jogos"}
        userId="u1"
        serverState={props.serverState ?? null}
        forceStart={props.forceStart ?? false}
      />,
    );
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

const dialog = () => document.querySelector('[role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("GuidedTour", () => {
  it("abre sozinho na primeira visita e pula passos sem alvo", () => {
    mount({});
    expect(dialog()?.textContent).toContain("Bem-vindo ao Palpiteiro");
    // 6 passos no capítulo; "recent-predictions" não está na tela → 5.
    expect(dialog()?.textContent).toContain("1 de 5");
  });

  it("não abre de novo depois de pulado ou concluído", () => {
    mount({ serverState: "dismissed" });
    expect(dialog()).toBeNull();
  });

  it("não abre se este aparelho já pulou, mesmo com o servidor atrasado", () => {
    window.localStorage.setItem("palpiteiro:tour:u1", "dismissed");
    mount({ serverState: null });
    expect(dialog()).toBeNull();
  });

  it("\"Pular tour\" fecha e grava dismissed no servidor e no aparelho", () => {
    mount({});
    act(() => button("Pular tour").click());
    expect(dialog()).toBeNull();
    expect(saveTourState).toHaveBeenCalledWith("dismissed");
    expect(window.localStorage.getItem("palpiteiro:tour:u1")).toBe("dismissed");
  });

  it("Esc também dispensa", () => {
    mount({});
    act(() => {
      dialog()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog()).toBeNull();
    expect(saveTourState).toHaveBeenCalledWith("dismissed");
  });

  it("chegar ao último passo grava o fim do capítulo antes do clique no jogo", () => {
    mount({});
    for (let i = 0; i < 4; i++) act(() => button("Próximo").click());
    expect(dialog()?.textContent).toContain("Abra um jogo");
    expect(dialog()?.textContent).toContain("5 de 5");
    expect(saveTourState).toHaveBeenCalledWith("jogos");
    // "Agora não" fecha sem dispensar: a parte do jogo ainda abre depois.
    act(() => button("Agora não").click());
    expect(dialog()).toBeNull();
    expect(saveTourState).toHaveBeenCalledTimes(1);
  });

  it("\"Abrir jogo\" clica no jogo destacado (teclado/leitor de tela)", () => {
    const row = document.querySelector<HTMLAnchorElement>('[data-tour="match-row"]')!;
    const onClick = vi.fn((e: Event) => e.preventDefault());
    row.addEventListener("click", onClick);
    mount({});
    for (let i = 0; i < 4; i++) act(() => button("Próximo").click());
    act(() => button("Abrir jogo").click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("põe o foco no botão principal ao abrir", () => {
    mount({});
    expect(document.activeElement).toBe(button("Próximo"));
  });

  it("Esc funciona mesmo com o foco fora do cartão", () => {
    mount({});
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog()).toBeNull();
  });

  it("\"Voltar\" volta pro passo anterior visível", () => {
    mount({});
    act(() => button("Próximo").click());
    act(() => button("Próximo").click());
    expect(dialog()?.textContent).toContain("Campeonato");
    act(() => button("Voltar").click());
    expect(dialog()?.textContent).toContain("Menu");
  });

  it("\"rever o tour\" força a partida mesmo já concluído e limpa a URL", () => {
    window.history.replaceState(null, "", "/jogos?league=br&tour=1");
    mount({ serverState: "done", forceStart: true });
    expect(dialog()?.textContent).toContain("Bem-vindo ao Palpiteiro");
    expect(window.location.search).toBe("?league=br");
  });

  it("não força se o ?tour=1 já saiu da URL (Back restaurando do cache)", () => {
    window.history.replaceState(null, "", "/jogos");
    mount({ serverState: "done", forceStart: true });
    expect(dialog()).toBeNull();
  });

  it("a página do jogo só abre depois da parte da lista", () => {
    mount({ chapter: "jogo", serverState: null });
    expect(dialog()).toBeNull();
  });

  it("a página do jogo abre com a lista vista e termina gravando done", () => {
    document.body.insertAdjacentHTML("afterbegin", '<form data-tour="palpite"></form>');
    mount({ chapter: "jogo", serverState: "jogos" });
    expect(dialog()?.textContent).toContain("O Palpite");
    act(() => button("Próximo").click());
    expect(dialog()?.textContent).toContain("Pronto");
    expect(saveTourState).toHaveBeenCalledWith("done");
  });
});
