import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PalpiteBot } from "@/components/palpites/palpite-bot";

// ADR 0065/0068: o robozinho dá um pulinho a cada etapa pronta, também com movimento
// reduzido (pedido do Fernando: parado, o run parece travado).
describe("pulinho do robozinho a cada etapa", () => {
  let container: HTMLDivElement;
  let root: Root;
  const animate = vi.fn();
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    animate.mockClear();
    (SVGElement.prototype as unknown as { animate: typeof animate }).animate =
      animate;
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    window.matchMedia = originalMatchMedia;
  });

  const reduced = (matches: boolean) => {
    window.matchMedia = (() => ({
      matches,
    })) as unknown as typeof window.matchMedia;
  };

  it("pula quando o beat sobe, não quando fica igual ou volta", () => {
    reduced(false);
    act(() => root.render(<PalpiteBot beat={0} />));
    expect(animate).not.toHaveBeenCalled();
    act(() => root.render(<PalpiteBot beat={1} />));
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => root.render(<PalpiteBot beat={1} />));
    act(() => root.render(<PalpiteBot beat={0} />));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("com movimento reduzido pula também", () => {
    reduced(true);
    act(() => root.render(<PalpiteBot beat={0} />));
    act(() => root.render(<PalpiteBot beat={2} />));
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
