// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { gatedMatcherRegex } from "@/lib/security/gated-routes";

/**
 * Menu sempre visível (#553): toda página que exige sessão (casa o matcher do
 * middleware) mora no grupo `app/(app)/`, cujo layout renderiza o AppShell. Página
 * logada nova fora do grupo sairia sem menu, que é o bug que este teste trava.
 */

const SAMPLE = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" || entry === "api" ? [] : pages(full);
    }
    return entry === "page.tsx" ? [relative(join(process.cwd(), "app"), dir)] : [];
  });
}

function urlOf(dir: string): string {
  const segs = dir
    .split(sep)
    .filter(Boolean)
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => (s.startsWith("[") ? SAMPLE : s));
  return `/${segs.join("/")}`;
}

const matcher = gatedMatcherRegex();
const all = pages(join(process.cwd(), "app"));
const gated = all.filter((dir) => matcher.test(urlOf(dir)));

describe("toda página logada tem o menu", () => {
  it("achou as páginas logadas", () => {
    expect(gated.map(urlOf)).toContain("/jogos");
    expect(gated.length).toBeGreaterThan(10);
  });

  it.each(gated)("app/%s está no grupo (app)", (dir) => {
    expect(dir.split(sep)[0]).toBe("(app)");
  });
});
