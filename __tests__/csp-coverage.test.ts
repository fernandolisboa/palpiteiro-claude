import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_HTML_SOURCES } from "@/lib/security/csp";

// Mesmo compilador de path que o Next usa pros `source` de headers() no next.config.
// Via require porque o build compilado do Next não publica tipos pra esse módulo.
const { pathToRegexp } = createRequire(import.meta.url)(
  "next/dist/compiled/path-to-regexp"
) as {
  pathToRegexp: (
    path: string,
    keys: unknown[],
    opts: { strict: boolean; sensitive: boolean; delimiter: string }
  ) => RegExp;
};

/**
 * Guarda de cobertura da CSP (#467, ADR 0040): TODA página do app recebe exatamente
 * UMA variante de CSP — com nonce (middleware, rota gateada) OU estática (next.config,
 * rota pública). Uma rota pública nova liberada no matcher sem entrar em
 * PUBLIC_HTML_SOURCES ficaria sem CSP; uma entrada em PUBLIC_HTML_SOURCES que também
 * casa o matcher mandaria duas políticas. As páginas vêm do filesystem (`app/**\/page.tsx`),
 * então página nova entra no teste sozinha.
 */

const source = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
const matcherMatch = source.match(/matcher:\s*\[\s*"([^"]+)"/);
if (!matcherMatch?.[1]) throw new Error("não achei o matcher em middleware.ts");
const matcherRe = new RegExp(`^${matcherMatch[1].replace(/\\\\/g, "\\")}$`);

const publicRes = PUBLIC_HTML_SOURCES.map((s) =>
  pathToRegexp(s, [], { strict: true, sensitive: false, delimiter: "/" })
);

function pagePaths(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "api") continue;
      out.push(...pagePaths(full));
    } else if (entry === "page.tsx") {
      const segs = relative(join(process.cwd(), "app"), dir)
        .split(sep)
        .filter(Boolean)
        // Route groups `(x)` não aparecem na URL; segmentos dinâmicos viram um valor
        // de exemplo (UUID pra servir de id do /p).
        .filter((s) => !/^\(.*\)$/.test(s))
        .map((s) =>
          s.startsWith("[") ? "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b" : s
        );
      out.push(`/${segs.join("/")}`);
    }
  }
  return out;
}

const pages = pagePaths(join(process.cwd(), "app"));

describe("CSP — toda página tem exatamente uma variante", () => {
  it("encontrou as páginas do app", () => {
    expect(pages).toContain("/");
    expect(pages).toContain("/jogos");
    expect(pages.length).toBeGreaterThan(10);
  });

  it.each(pages)("%s", (path) => {
    const gated = matcherRe.test(path);
    const staticCsp = publicRes.some((re) => re.test(path));
    expect({ path, gated, staticCsp }).toEqual({
      path,
      gated: !staticCsp,
      staticCsp: !gated,
    });
  });

  it("a variante estática não pega rotas gateadas vizinhas do /p", () => {
    for (const path of ["/p", "/perfil", "/p/abc/edit"]) {
      expect(
        publicRes.some((re) => re.test(path)),
        path
      ).toBe(false);
    }
  });
});
