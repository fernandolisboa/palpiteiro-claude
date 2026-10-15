import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { ThemeProvider } from "next-themes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_PROVIDER_PROPS, THEME_SCRIPT } from "@/lib/theme";

/**
 * `THEME_SCRIPT` substitui o anti-flash do next-themes (ver lib/theme.ts). Aqui os dois
 * rodam no mesmo cenário e o <html> tem que sair igual — se um bump do next-themes ou uma
 * prop nova mudar o comportamento do original, este teste acusa.
 */

// Script original do next-themes pras mesmas props (sem o scriptProps que o desliga).
// Com defaultTheme "system" o next-themes consulta o matchMedia ao renderizar quando há
// `window` (o jsdom tem window mas não matchMedia): stub só pra extrair o script.
const { scriptProps: _, ...originalProps } = THEME_PROVIDER_PROPS;
vi.stubGlobal("matchMedia", () => ({ matches: false }));
const ORIGINAL_SCRIPT =
  /<script[^>]*>([\s\S]*?)<\/script>/.exec(
    renderToString(
      createElement(ThemeProvider, originalProps, createElement("div"))
    )
  )?.[1] ?? "";
vi.unstubAllGlobals();

type Scenario = {
  name: string;
  stored: string | null;
  systemDark: boolean;
  storageThrows?: boolean;
};

const scenarios: Scenario[] = [
  // Default "system" (#574): sem tema salvo, segue o sistema.
  { name: "nada salvo + sistema claro → light", stored: null, systemDark: false },
  { name: "nada salvo + sistema escuro → dark", stored: null, systemDark: true },
  { name: "light salvo", stored: "light", systemDark: true },
  { name: "dark salvo", stored: "dark", systemDark: false },
  { name: "system + sistema escuro", stored: "system", systemDark: true },
  { name: "system + sistema claro", stored: "system", systemDark: false },
  {
    name: "localStorage indisponível",
    stored: null,
    systemDark: false,
    storageThrows: true,
  },
];

function run(script: string, s: Scenario) {
  const root = document.documentElement;
  root.className = "light";
  root.removeAttribute("style");
  localStorage.clear();
  if (s.stored !== null) localStorage.setItem("theme", s.stored);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: s.systemDark }))
  );
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  if (s.storageThrows)
    getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
  new Function(script)();
  getItem.mockRestore();
  return { className: root.className, colorScheme: root.style.colorScheme };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("THEME_SCRIPT", () => {
  it("o script original do next-themes foi extraído", () => {
    expect(ORIGINAL_SCRIPT).toContain("localStorage");
  });

  it.each(scenarios)("$name: igual ao next-themes", (s) => {
    expect(run(THEME_SCRIPT, s)).toEqual(run(ORIGINAL_SCRIPT, s));
  });
});

describe("THEME_SCRIPT — default do sistema (#574)", () => {
  it("nada salvo segue o sistema", () => {
    expect(run(THEME_SCRIPT, { name: "claro", stored: null, systemDark: false })).toEqual({
      className: "light",
      colorScheme: "light",
    });
    expect(run(THEME_SCRIPT, { name: "escuro", stored: null, systemDark: true })).toEqual({
      className: "dark",
      colorScheme: "dark",
    });
  });
});
