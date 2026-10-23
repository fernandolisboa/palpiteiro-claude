import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import {
  revealSetting,
  SettingsSearch,
} from "@/components/admin/settings-search";

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(target: EventTarget, k: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true })
    );
  });
}

describe("SettingsSearch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let input: HTMLInputElement;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    push.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<SettingsSearch />));
    input = container.querySelector("input")!;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const options = () => [...container.querySelectorAll('[role="option"]')];

  it("lista as configurações que casam e fecha com a consulta vazia", () => {
    act(() => input.focus());
    type(input, "ao vivo");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(options()[0]?.textContent).toContain("Modo ao vivo");
    type(input, "");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter abre a primeira sem o scroll do Next; setas trocam a ativa", () => {
    act(() => input.focus());
    type(input, "modelo perfil");
    key(input, "ArrowDown");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    key(input, "ArrowUp");
    key(input, "Enter");
    expect(push).toHaveBeenCalledWith("/perfil#modelo-de-analise", {
      scroll: false,
    });
    expect(input.value).toBe("");
  });

  it("página sem âncora navega com o scroll normal", () => {
    act(() => input.focus());
    type(input, "custos de ia");
    key(input, "Enter");
    expect(push).toHaveBeenCalledWith("/admin/ia/custos");
  });

  it("mostra quando nada casa", () => {
    act(() => input.focus());
    type(input, "xyzzy");
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain("Nenhuma configuração");
  });

  it('"/" foca o campo, mas não quando já se digita em outro campo', () => {
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    key(other, "/");
    expect(document.activeElement).toBe(other);
    act(() => other.blur());
    key(document.body, "/");
    expect(document.activeElement).toBe(input);
  });
});

describe("revealSetting", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("espera a âncora aparecer, foca o bloco e tira o destaque depois", () => {
    vi.useFakeTimers();
    revealSetting("flag-x");
    const el = document.createElement("div");
    el.id = "flag-x";
    document.body.appendChild(el);
    vi.advanceTimersByTime(150);
    expect(el.hasAttribute("data-search-hit")).toBe(true);
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(el);
    vi.advanceTimersByTime(3000);
    expect(el.hasAttribute("data-search-hit")).toBe(false);
  });
});
