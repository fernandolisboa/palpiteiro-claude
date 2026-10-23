import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { MatchSearchInput, SEARCH_DEBOUNCE_MS } from "@/components/match-list/match-search-input";
import { TeamFilter } from "@/components/match-list/team-filter";
import { teamOptionGroups } from "@/lib/view/match-search";
import type { RangeNavState } from "@/lib/view/range-href";

const NAV: RangeNavState = {
  league: "bsa",
  preset: "custom",
  from: "2026-10-24",
  to: "2026-10-26",
  filters: { analyzed: "no" },
};

// Digita como o React espera (o setter nativo + evento input), pro onChange disparar.
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("filtros da lista de jogos (#643)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    router.push.mockClear();
    router.replace.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("busca: espera parar de digitar e troca só o q da URL (replace)", () => {
    act(() => root.render(<MatchSearchInput nav={NAV} />));
    const input = container.querySelector("input")!;
    act(() => type(input, "fla"));
    act(() => type(input, "flamengo  "));
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26&q=flamengo&analyzed=no",
      { scroll: false },
    );
  });

  it("busca: Enter busca na hora; o × limpa o q", () => {
    act(() => root.render(<MatchSearchInput nav={{ ...NAV, filters: { q: "gremio" } }} />));
    const input = container.querySelector("input")!;
    expect(input.value).toBe("gremio");
    act(() => type(input, "sábado"));
    act(() => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26&q=s%C3%A1bado",
      { scroll: false },
    );
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Limpar busca"]')!.click());
    expect(router.replace).toHaveBeenLastCalledWith(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26",
      { scroll: false },
    );
  });

  it("busca: sem mudança não navega", () => {
    act(() => root.render(<MatchSearchInput nav={{ ...NAV, filters: { q: "gremio" } }} />));
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("busca: a cópia sem foco acompanha a URL", () => {
    act(() => root.render(<MatchSearchInput nav={NAV} />));
    act(() => root.render(<MatchSearchInput nav={{ ...NAV, filters: { q: "champions" } }} />));
    expect(container.querySelector("input")!.value).toBe("champions");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("time: escolher o escudo navega com o team e preserva o resto", () => {
    const groups = teamOptionGroups(
      [
        { name: "CR Flamengo", league: "brasileirao_a", crestUrl: null },
        { name: "SE Palmeiras", league: "brasileirao_a", crestUrl: null },
      ],
      ["bsa"],
    );
    act(() => root.render(<TeamFilter nav={NAV} groups={groups} surface="popover" />));
    act(() => container.querySelector("button")!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const names = [...dialog.querySelectorAll("li button")].map((b) => b.textContent);
    expect(names).toEqual(["Flamengo", "Palmeiras"]);
    act(() => (dialog.querySelectorAll("li button")[1] as HTMLButtonElement).click());
    expect(router.push).toHaveBeenCalledWith(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26&team=SE+Palmeiras&analyzed=no",
    );
  });

  it("time escolhido: o chip mostra o nome e o × limpa só o time", () => {
    const groups = teamOptionGroups(
      [{ name: "CR Flamengo", league: "brasileirao_a", crestUrl: null }],
      ["bsa"],
    );
    act(() =>
      root.render(
        <TeamFilter
          nav={{ ...NAV, filters: { team: "CR Flamengo", analyzed: "no" } }}
          groups={groups}
          selected={groups[0].teams[0]}
          surface="sheet"
        />,
      ),
    );
    expect(container.querySelector("button")!.textContent).toContain("Flamengo");
    expect(container.querySelector('a[aria-label="Limpar time"]')!.getAttribute("href")).toBe(
      "/jogos?league=bsa&preset=custom&from=2026-10-24&to=2026-10-26&analyzed=no",
    );
  });
});
