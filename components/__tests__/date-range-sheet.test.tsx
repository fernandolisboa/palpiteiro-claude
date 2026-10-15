import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DateRangeSheet } from "@/components/date-range-sheet";

// Abre o "Escolher datas" de verdade (Radix no jsdom) e lê o conteúdo do portal.
describe("DateRangeSheet — conteúdo aberto (#577)", () => {
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
    document.body.innerHTML = "";
  });

  function open(props: Partial<Parameters<typeof DateRangeSheet>[0]> & { surface: "sheet" | "popover" }) {
    act(() => {
      root.render(
        <DateRangeSheet league="all" active={false} label="Escolher datas" {...props} />,
      );
    });
    act(() => {
      container.querySelector("button")!.click();
    });
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  const buttons = (dialog: HTMLElement) =>
    [...dialog.querySelectorAll("button")].map((b) => b.textContent?.trim());

  it("popover: o dialog tem o nome do título 'Escolher datas'", () => {
    const dialog = open({ surface: "popover" });
    expect(dialog).not.toBeNull();
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Escolher datas");
  });

  it.each(["popover", "sheet"] as const)("%s sem intervalo aplicado: sem 'Limpar'", (surface) => {
    const dialog = open({ surface });
    expect(buttons(dialog)).toContain("Aplicar");
    expect(buttons(dialog)).not.toContain("Limpar");
  });

  it.each(["popover", "sheet"] as const)("%s com intervalo aplicado: 'Limpar' aparece", (surface) => {
    const dialog = open({
      surface,
      active: true,
      label: "18/10 – 25/10",
      from: "2026-10-18",
      to: "2026-10-25",
    });
    expect(buttons(dialog)).toContain("Limpar");
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="De"]')?.value).toBe("2026-10-18");
  });
});
