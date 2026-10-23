import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RevisitRefreshClient } from "@/components/revisit-refresh-client";
import { resetRouterCacheState } from "@/lib/nav/router-cache";

// Simula a navegação do App Router: a página sai da tela e volta do cache com o MESMO
// render do servidor (mesmo id) — é isso que o cache do roteador faz (#639).
describe("RevisitRefreshClient (#639)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const refresh = vi.fn();
  const router = { refresh } as unknown as AppRouterInstance;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetRouterCacheState();
    refresh.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function show(renderId: string, maxAgeMs = 30_000) {
    act(() => {
      root.render(
        <AppRouterContext.Provider value={router}>
          <RevisitRefreshClient renderId={renderId} maxAgeMs={maxAgeMs} />
        </AppRouterContext.Provider>,
      );
    });
  }
  function leave() {
    act(() => root.render(<div />));
  }

  it("1ª visita (veio do servidor agora) não relê", () => {
    show("r1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("volta do cache em menos de 30s: mostra o guardado, sem reler", () => {
    show("r1");
    leave();
    vi.setSystemTime(1_000_000 + 20_000);
    show("r1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("volta do cache depois de 30s: mostra o guardado e relê em segundo plano", () => {
    show("r1");
    leave();
    vi.setSystemTime(1_000_000 + 45_000);
    show("r1");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("de volta à aba depois de 30s relê; antes, não", () => {
    show("r1");
    vi.setSystemTime(1_000_000 + 10_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).not.toHaveBeenCalled();
    vi.setSystemTime(1_000_000 + 40_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("depois de sair da página, a volta à aba não mexe nela", () => {
    show("r1");
    leave();
    vi.setSystemTime(1_000_000 + 40_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sem App Router (render solto, testes): não faz nada nem quebra", () => {
    act(() => root.render(<RevisitRefreshClient renderId="x" maxAgeMs={0} />));
    expect(refresh).not.toHaveBeenCalled();
  });
});
