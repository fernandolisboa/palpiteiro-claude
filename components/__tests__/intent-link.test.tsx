import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentLink } from "@/components/intent-link";
import { resetIntentPrefetch } from "@/lib/nav/intent-prefetch";

describe("IntentLink (#639)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const prefetch = vi.fn();
  const refresh = vi.fn();
  const router = { prefetch, refresh, push: vi.fn(), replace: vi.fn() };
  let hover = true;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    resetIntentPrefetch();
    prefetch.mockClear();
    refresh.mockClear();
    window.history.replaceState(null, "", "/jogos");
    hover = true;
    window.matchMedia = ((q: string) => ({
      matches: q === "(hover: hover)" ? hover : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    renderLink();
  });

  function renderLink(props: Partial<Parameters<typeof IntentLink>[0]> = {}) {
    act(() => {
      root.render(
        <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
          <IntentLink href="/match/1?back=%2Fjogos" {...props}>
            jogo
          </IntentLink>
        </AppRouterContext.Provider>,
      );
    });
  }
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const link = () => container.querySelector("a")!;
  // React escuta `mouseenter` pelo par mouseover/mouseout.
  const enter = () =>
    act(() => {
      link().dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
    });
  const leave = () =>
    act(() => {
      link().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });

  it("mouse parado em cima: busca a página inteira (kind full)", () => {
    enter();
    act(() => vi.advanceTimersByTime(150));
    expect(prefetch).toHaveBeenCalledWith("/match/1?back=%2Fjogos", { kind: "full" });
  });

  it("mouse só de passagem (sai antes de 120ms): não busca", () => {
    enter();
    act(() => vi.advanceTimersByTime(60));
    leave();
    act(() => vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("a mesma URL não é buscada de novo logo em seguida", () => {
    enter();
    act(() => vi.advanceTimersByTime(150));
    leave();
    enter();
    act(() => vi.advanceTimersByTime(150));
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  // jsdom não navega: o `document` cancela o padrão DEPOIS do handler do React (que
  // escuta na raiz), então o IntentLink vê um clique normal.
  const click = (init: MouseEventInit = {}) => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("click", stop);
    act(() => {
      link().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
    });
    document.removeEventListener("click", stop);
  };

  it("clique: pede a busca completa (chave com a query) antes de navegar", () => {
    click();
    expect(prefetch).toHaveBeenCalledWith("/match/1?back=%2Fjogos", { kind: "full" });
  });

  it("clicou antes do tempo do hover: uma busca só", () => {
    enter();
    act(() => vi.advanceTimersByTime(50));
    click();
    act(() => vi.advanceTimersByTime(200));
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("ctrl/cmd+clique (nova aba): não busca", () => {
    click({ ctrlKey: true });
    click({ metaKey: true });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("saiu da tela com o timer correndo: não busca", () => {
    enter();
    act(() => root.render(<div />));
    act(() => vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("clique em URL sem query: a navegação comum busca (prioridade alta), sem busca extra", () => {
    renderLink({ href: "/dashboard" });
    click();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("shift/alt+clique ou clique cancelado por quem usa o link: não busca", () => {
    click({ shiftKey: true });
    click({ altKey: true });
    renderLink({ onClick: (e) => e.preventDefault() });
    click();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("clique no link da página atual: relê a página", () => {
    window.history.replaceState(null, "", "/match/1?back=%2Fjogos");
    click();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("âncora na página atual: só rola, não relê", () => {
    renderLink({ href: "/jogos#fim" });
    click();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("nova aba (target=_blank) ou download: nem o hover busca", () => {
    renderLink({ target: "_blank" });
    enter();
    act(() => vi.advanceTimersByTime(150));
    renderLink({ download: true });
    enter();
    act(() => vi.advanceTimersByTime(150));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("link pra fora do app: não busca", () => {
    renderLink({ href: "https://example.com/x?y=1" });
    enter();
    act(() => vi.advanceTimersByTime(150));
    click();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("tela de toque (sem hover): não busca", () => {
    hover = false;
    enter();
    act(() => vi.advanceTimersByTime(150));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("renderiza um <a> normal, mesmo sem App Router", () => {
    const html = renderToStaticMarkup(<IntentLink href="/jogos">jogos</IntentLink>);
    expect(html).toContain('href="/jogos"');
  });
});
