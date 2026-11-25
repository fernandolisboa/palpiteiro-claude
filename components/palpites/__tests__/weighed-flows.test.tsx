import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEIGHED_NAO_VIRA,
  WEIGHED_VIRA,
} from "@/components/__tests__/firewall-helpers";
import {
  WeighedFlows,
  WeighedPlayback,
} from "@/components/palpites/weighed-flows";
import { MAX_DOTS } from "@/lib/view/palpite-weighed";

// A parte cliente do "o que pesou" (#683): os arcos medem a caixa no cliente e o gatilho
// da animação liga/desliga `data-play` no bloco. jsdom não faz layout nem observa a tela:
// largura, ResizeObserver, IntersectionObserver e matchMedia são stubs.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WeighedFlows", () => {
  let width = 0;
  const resizes: Array<() => void> = [];
  const disconnects = vi.fn();

  beforeEach(() => {
    width = 358;
    resizes.length = 0;
    disconnects.mockClear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => width
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {}
        observe() {
          resizes.push(() => this.cb());
        }
        disconnect() {
          disconnects();
        }
      }
    );
  });

  it("mede a caixa no cliente e desenha os arcos (<path>), os rótulos e as bolinhas", () => {
    const { bar } = WEIGHED_VIRA();
    act(() => root.render(<WeighedFlows bar={bar} />));
    const box = container.querySelector<HTMLElement>("[data-pesou-flows]")!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.style.height).toBe(`${bar.arcsHeight}px`);
    const dests = bar.flows.flatMap((f) => f.dests);
    expect(dests.length).toBeGreaterThan(0);
    const paths = box.querySelectorAll("svg g.pesou-arc path");
    // Um arco (traço + ponta) por destino da barra.
    expect(paths.length).toBe(dests.length * 2);
    expect(paths[0].getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+ A/);
    const labels = box.querySelectorAll(":scope > span");
    expect(labels.length).toBe(dests.length);
    expect(labels[0].textContent).toMatch(/^\d+ pts?$/);
    const dots = box.querySelectorAll("i.pesou-fly");
    expect(dots.length).toBe(
      dests.reduce((n, d) => n + Math.min(d.pts, MAX_DOTS), 0)
    );
  });

  it("refaz no resize; largura 0 (sem layout) não desenha nada", () => {
    const { bar } = WEIGHED_VIRA();
    width = 0;
    act(() => root.render(<WeighedFlows bar={bar} />));
    expect(container.querySelector("path")).toBeNull();
    width = 300;
    act(() => resizes.forEach((r) => r()));
    const d300 = container.querySelector("path")!.getAttribute("d");
    width = 600;
    act(() => resizes.forEach((r) => r()));
    expect(container.querySelector("path")!.getAttribute("d")).not.toBe(d300);
  });

  it("sem fluxos (arcsHeight 0) não rende; quando a caixa entra depois, mede (N1)", () => {
    const { bar } = WEIGHED_VIRA();
    const empty = { ...bar, flows: [], arcsHeight: 0 as const };
    act(() => root.render(<WeighedFlows bar={empty} />));
    expect(container.innerHTML).toBe("");
    act(() => root.render(<WeighedFlows bar={bar} />));
    expect(container.querySelectorAll("svg path").length).toBe(
      bar.flows.flatMap((f) => f.dests).length * 2
    );
  });

  it("desmontar desliga o ResizeObserver", () => {
    act(() => root.render(<WeighedFlows bar={WEIGHED_NAO_VIRA().bar} />));
    act(() => root.render(<></>));
    expect(disconnects).toHaveBeenCalled();
  });
});

describe("WeighedPlayback", () => {
  type IoCb = (entries: Array<{ isIntersecting: boolean }>) => void;
  let fire: IoCb = () => {};
  const observed: Element[] = [];
  const ioDisconnect = vi.fn();
  let reduced = false;

  beforeEach(() => {
    vi.useFakeTimers();
    fire = () => {};
    observed.length = 0;
    ioDisconnect.mockClear();
    reduced = false;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IoCb) {
          fire = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {
          ioDisconnect();
        }
      }
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: reduced && q.includes("reduce"),
      }))
    );
  });

  const block = () => container.querySelector<HTMLElement>(".pesou")!;
  const mount = () =>
    act(() =>
      root.render(
        <section className="pesou">
          <WeighedPlayback />
        </section>
      )
    );

  it("ao entrar na tela liga data-play no bloco e tira depois dos 2 ciclos", () => {
    mount();
    expect(observed).toEqual([block()]);
    expect(block().hasAttribute("data-play")).toBe(false);
    act(() => fire([{ isIntersecting: false }]));
    expect(block().hasAttribute("data-play")).toBe(false);
    act(() => fire([{ isIntersecting: true }]));
    expect(block().hasAttribute("data-play")).toBe(true);
    // Toca uma vez só: o observador sai assim que dispara.
    expect(ioDisconnect).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2 * 5400));
    expect(block().hasAttribute("data-play")).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(block().hasAttribute("data-play")).toBe(false);
  });

  it("prefers-reduced-motion: nem observa, nunca liga", () => {
    reduced = true;
    mount();
    expect(observed).toEqual([]);
    act(() => fire([{ isIntersecting: true }]));
    expect(block().hasAttribute("data-play")).toBe(false);
  });

  it("desmontar no meio: desliga o observador, limpa o timer e tira o data-play", () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    mount();
    act(() => fire([{ isIntersecting: true }]));
    const el = block();
    expect(el.hasAttribute("data-play")).toBe(true);
    ioDisconnect.mockClear();
    // Desmonta só o gatilho; o bloco fica (o efeito limpa o que pôs nele).
    act(() => root.render(<section className="pesou" />));
    expect(ioDisconnect).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(el.hasAttribute("data-play")).toBe(false);
    // O timer limpo não roda mais.
    expect(vi.getTimerCount()).toBe(0);
  });
});
