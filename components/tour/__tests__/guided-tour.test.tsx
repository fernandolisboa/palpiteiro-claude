import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O tour lê o `?tour=1` por `useSearchParams`; fora do Next, vem da URL do jsdom.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/app/actions/tour", () => ({
  saveTourState: vi.fn(async () => ({ ok: true })),
}));

import { saveTourState } from "@/app/actions/tour";
import { MatchTabs } from "@/components/match-tabs";
import { GuidedTour } from "@/components/tour/guided-tour";
import { TOUR_TAB_EVENT, type TourChapter, type TourState } from "@/lib/tour/steps";

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

  it("\"rever o tour\" clicado já na página abre sem remontar", () => {
    window.history.replaceState(null, "", "/jogos");
    mount({ serverState: "done" });
    expect(dialog()).toBeNull();
    window.history.replaceState(null, "", "/jogos?tour=1");
    mount({ serverState: "done", forceStart: true });
    expect(dialog()?.textContent).toContain("Bem-vindo ao Palpiteiro");
    expect(window.location.search).toBe("");
  });

  it("re-render no meio do tour forçado (URL já limpa) não fecha nem reinicia", () => {
    window.history.replaceState(null, "", "/jogos?tour=1");
    mount({ serverState: "done", forceStart: true });
    act(() => button("Próximo").click());
    const step = dialog()?.textContent;
    mount({ serverState: "done", forceStart: false });
    expect(dialog()?.textContent).toBe(step);
  });

  it("a página do jogo só abre depois da parte da lista", () => {
    mount({ chapter: "jogo", serverState: null });
    expect(dialog()).toBeNull();
  });

  it("a página do jogo abre com a lista vista e termina gravando done", () => {
    document.body.insertAdjacentHTML("afterbegin", '<form data-tour="palpite"></form>');
    mount({ chapter: "jogo", serverState: "jogos" });
    expect(dialog()?.textContent).toContain("Palpite da IA");
    act(() => button("Próximo").click());
    expect(dialog()?.textContent).toContain("Pronto");
    expect(saveTourState).toHaveBeenCalledWith("done");
  });

  describe("passos com aba (#576)", () => {
    // Página do jogo: o palpite fora das abas; cada painel com o alvo, só o primeiro visível.
    const tabsHtml = `
      <form data-tour="palpite"></form>
      <div data-tab="mercados" data-tour="mercados">tabela</div>
      <div data-tab="seu-palpite" data-tour="seu-palpite" hidden>seu palpite</div>
      <div data-tab="dados" data-tour="match-stats" hidden>dados</div>
    `;
    const panel = (tour: string) =>
      document.querySelector<HTMLElement>(`[data-tour="${tour}"]`)!;
    // Ouvinte no papel do MatchTabs: tira o hidden do painel da aba pedida (síncrono).
    const tabEvents: unknown[] = [];
    const listener = (event: Event) => {
      const tab = (event as CustomEvent<unknown>).detail;
      tabEvents.push(tab);
      for (const el of document.querySelectorAll<HTMLElement>("[data-tab]")) {
        el.hidden = el.dataset.tab !== tab;
      }
    };
    afterEach(() => {
      window.removeEventListener(TOUR_TAB_EVENT, listener);
      tabEvents.length = 0;
    });

    it("abre a aba do passo antes do spotlight", () => {
      document.body.insertAdjacentHTML("afterbegin", tabsHtml);
      window.addEventListener(TOUR_TAB_EVENT, listener);
      mount({ chapter: "jogo", serverState: "jogos" });
      expect(dialog()?.textContent).toContain("Palpite da IA");
      // palpite, mercados, seu-palpite, dados, Pronto: os escondidos contam.
      expect(dialog()?.textContent).toContain("1 de 5");
      act(() => button("Próximo").click());
      act(() => button("Próximo").click());
      expect(dialog()?.textContent).toContain("Seu palpite");
      expect(tabEvents).toEqual(["mercados", "seu-palpite"]);
      expect(panel("seu-palpite").hidden).toBe(false);
      expect(panel("mercados").hidden).toBe(true);
      // O alvo foi achado (visível): o spotlight rolou até ele.
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith(
        expect.objectContaining({ block: "center" }),
      );
      expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(
        panel("seu-palpite"),
      );
    });

    it("sem ouvinte, o passo com aba e alvo existente ainda conta no N de M", () => {
      document.body.insertAdjacentHTML("afterbegin", tabsHtml);
      mount({ chapter: "jogo", serverState: "jogos" });
      expect(dialog()?.textContent).toContain("1 de 5");
      for (let i = 0; i < 3; i++) act(() => button("Próximo").click());
      expect(dialog()?.textContent).toContain("Números do jogo");
      expect(dialog()?.textContent).toContain("4 de 5");
    });

    it("\"Voltar\" pra um passo de outra aba dispara o evento com a aba certa", () => {
      document.body.insertAdjacentHTML("afterbegin", tabsHtml);
      window.addEventListener(TOUR_TAB_EVENT, listener);
      mount({ chapter: "jogo", serverState: "jogos" });
      for (let i = 0; i < 3; i++) act(() => button("Próximo").click());
      expect(panel("match-stats").hidden).toBe(false);
      act(() => button("Voltar").click());
      expect(dialog()?.textContent).toContain("Seu palpite");
      expect(tabEvents.at(-1)).toBe("seu-palpite");
      expect(panel("seu-palpite").hidden).toBe(false);
      expect(panel("match-stats").hidden).toBe(true);
    });

    // MatchTabs de verdade num root próprio, desmontado no afterEach (mesmo se o teste
    // falhar no meio).
    const tabsCleanups: (() => void)[] = [];
    afterEach(() => {
      for (const cleanup of tabsCleanups.splice(0)) cleanup();
    });
    function mountMatchTabs(registerBets: boolean) {
      const tabsHost = document.createElement("div");
      document.body.appendChild(tabsHost);
      const tabsRoot = createRoot(tabsHost);
      tabsCleanups.push(() => {
        act(() => tabsRoot.unmount());
        tabsHost.remove();
      });
      act(() =>
        tabsRoot.render(
          <MatchTabs
            initialTab="mercados"
            registerBets={registerBets}
            mercados={<p>tabela</p>}
            seuPalpite={<p>seu palpite</p>}
            dados={<p>dados</p>}
          />,
        ),
      );
    }

    it("com o MatchTabs de verdade: troca a aba sem aviso de flushSync", () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      document.body.insertAdjacentHTML("afterbegin", '<form data-tour="palpite"></form>');
      mountMatchTabs(true);
      mount({ chapter: "jogo", serverState: "jogos" });
      for (let i = 0; i < 3; i++) act(() => button("Próximo").click());
      expect(dialog()?.textContent).toContain("Números do jogo");
      expect(panel("match-stats").hidden).toBe(false);
      expect(panel("mercados").hidden).toBe(true);
      expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(
        panel("match-stats"),
      );
      expect(new URL(window.location.href).searchParams.get("aba")).toBe("dados");
      const flushWarnings = errors.mock.calls.filter((args) =>
        String(args[0]).includes("flushSync"),
      );
      expect(flushWarnings).toEqual([]);
    });

    it("jogo só leitura: pula Mercados e Seu palpite (falam de registrar), mantém Dados", () => {
      document.body.insertAdjacentHTML("afterbegin", '<form data-tour="palpite"></form>');
      mountMatchTabs(false);
      mount({ chapter: "jogo", serverState: "jogos" });
      expect(dialog()?.textContent).toContain("Palpite da IA");
      // palpite, dados, Pronto.
      expect(dialog()?.textContent).toContain("1 de 3");
      act(() => button("Próximo").click());
      expect(dialog()?.textContent).toContain("Números do jogo");
      expect(dialog()?.textContent).toContain("2 de 3");
      expect(panel("match-stats").hidden).toBe(false);
      act(() => button("Próximo").click());
      expect(dialog()?.textContent).toContain("Pronto");
      expect(saveTourState).toHaveBeenCalledWith("done");
      // Nenhum passo falou de registrar aposta.
      expect(document.body.textContent).not.toContain("Registrar apostas");
    });

    it("passo sem aba não dispara o evento", () => {
      document.body.insertAdjacentHTML("afterbegin", tabsHtml);
      window.addEventListener(TOUR_TAB_EVENT, listener);
      mount({ chapter: "jogo", serverState: "jogos" });
      expect(tabEvents).toEqual([]);
    });
  });
});
