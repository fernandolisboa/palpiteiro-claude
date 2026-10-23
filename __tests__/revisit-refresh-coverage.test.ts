// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Navegação rápida (#639): com o cache do roteador ligado (`staleTimes` em
 * next.config.ts), página logada reabre do cache. Sem o `RevisitRefresh`, ela ficaria
 * com os dados da 1ª visita por até 5 min. Página nova no grupo `(app)` sem ele falha
 * aqui. Exceção: conteúdo fixo, sem dado que mude.
 */
const STATIC_PAGES = new Set(["como-usar/page.tsx"]);

const root = join(process.cwd(), "app", "(app)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : pages(full);
    return entry === "page.tsx" ? [relative(root, full)] : [];
  });
}

const all = pages(root).filter((p) => !STATIC_PAGES.has(p));

describe("toda página logada relê o servidor quando reaberta do cache", () => {
  it("achou as páginas", () => {
    expect(all).toContain("jogos/page.tsx");
    expect(all.length).toBeGreaterThan(15);
  });

  it.each(all)("app/(app)/%s renderiza <RevisitRefresh", (page) => {
    // Sem comentários: citar o componente num comentário não conta.
    const code = readFileSync(join(root, page), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<RevisitRefresh[\s/]/);
  });
});

describe("configuração", () => {
  it("cache do roteador: 5 min pra página dinâmica", () => {
    const src = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(src).toMatch(/staleTimes:\s*\{\s*dynamic:\s*300\s*\}/);
  });

  it("funções na mesma região do banco (gru1, ADR 0067)", () => {
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as { regions?: string[] };
    expect(vercel.regions).toEqual(["gru1"]);
  });
});
