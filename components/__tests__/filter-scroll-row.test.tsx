import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterScrollRow, revealActiveChip } from "@/components/filter-scroll-row";

// O jsdom não tem layout: as caixas e o scrollLeft são simulados. A linha tem 390px
// de largura (x de 0 a 390) e 20px de gutter (px-5), como no celular.
function box(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 32,
    height: 32,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeRow(chipLeft: number | null, chipWidth = 110, initialScroll = 0) {
  const row = document.createElement("div");
  row.style.paddingLeft = "20px";
  row.style.paddingRight = "20px";
  let scroll = initialScroll;
  Object.defineProperty(row, "scrollLeft", {
    configurable: true,
    get: () => scroll,
    set: (v: number) => {
      scroll = v;
    },
  });
  row.getBoundingClientRect = () => box(0, 390);
  const plain = document.createElement("a");
  plain.getBoundingClientRect = () => box(20, 60);
  row.appendChild(plain);
  if (chipLeft !== null) {
    const chip = document.createElement("button");
    chip.setAttribute("aria-current", "true");
    chip.getBoundingClientRect = () => box(chipLeft, chipWidth);
    row.appendChild(chip);
  }
  document.body.appendChild(row);
  return row;
}

describe("revealActiveChip (#577)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("chip cortado à direita: rola até ele caber, parando no gutter", () => {
    // Chip de 420 a 530: passa 160px do limite visível (390 - 20).
    const row = fakeRow(420);
    revealActiveChip(row);
    expect(row.scrollLeft).toBe(160);
  });

  it("chip já visível: não rola", () => {
    const row = fakeRow(200);
    revealActiveChip(row);
    expect(row.scrollLeft).toBe(0);
  });

  it("chip cortado à esquerda (linha já rolada): volta só o necessário", () => {
    const row = fakeRow(-30, 110, 100);
    revealActiveChip(row);
    expect(row.scrollLeft).toBe(50);
  });

  it("sem chip selecionado: não rola", () => {
    const row = fakeRow(null);
    revealActiveChip(row);
    expect(row.scrollLeft).toBe(0);
  });
});

describe("FilterScrollRow (#577)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("SSR: a linha rolável com os filhos (alvos do tour intactos)", () => {
    const html = renderToStaticMarkup(
      <FilterScrollRow activeKey="k" className="px-5 pb-3">
        <div data-tour="date-range">chips</div>
      </FilterScrollRow>,
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("px-5 pb-3");
    expect(html).toContain('data-tour="date-range"');
  });

  it("ao montar e ao trocar o filtro, rola a própria linha; nunca a página", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    let chipLeft = 420;
    const writes: number[] = [];
    const rects = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        return this.hasAttribute("aria-current") ? box(chipLeft, 110) : box(0, 390);
      });
    const scrollLeft = vi
      .spyOn(Element.prototype, "scrollLeft", "set")
      .mockImplementation((v: number) => {
        writes.push(v);
      });

    const render = (key: string) =>
      act(() => {
        root.render(
          <FilterScrollRow activeKey={key}>
            <a href="/a">5 dias</a>
            <button type="button" aria-current="true">
              18/10 – 25/10
            </button>
          </FilterScrollRow>,
        );
      });

    render("custom-1");
    // Sem padding computado no jsdom: 530 - 390 = 140.
    expect(writes).toEqual([140]);

    // Mesmo filtro, novo render: não rola de novo.
    render("custom-1");
    expect(writes).toHaveLength(1);

    // Outro filtro: rola de novo.
    chipLeft = 400;
    render("custom-2");
    expect(writes).toHaveLength(2);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    rects.mockRestore();
    scrollLeft.mockRestore();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });
});
