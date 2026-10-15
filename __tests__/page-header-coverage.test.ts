// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Um cabeçalho por página (ADR 0056): as telas logadas de usuário usam o
 * `PageHeader` em vez de montar o próprio `<h1>`. Fora: a página do jogo (PR 3 da
 * revisão de design), o admin (tem o `PageHeading` próprio), testes e os estados de
 * erro/404/loading (cartão de estado, não cabeçalho de página).
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" || entry === "node_modules" ? [] : tsxFiles(full);
    }
    return entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });
}

const ROOT = process.cwd();
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const hasH1 = (f: string) => /<h1[\s>]/.test(readFileSync(f, "utf8"));

const SKIP_APP = [/^app\/\(app\)\/match\//, /^app\/\(app\)\/admin\//];
const SKIP_FILES = new Set(["error.tsx", "not-found.tsx", "loading.tsx"]);

describe("cabeçalho único nas telas logadas", () => {
  it("nenhum <h1> direto em app/(app) fora do jogo e do admin", () => {
    const offenders = tsxFiles(join(ROOT, "app", "(app)"))
      .filter((f) => !SKIP_APP.some((re) => re.test(rel(f))))
      .filter((f) => !SKIP_FILES.has(f.split(sep).pop() ?? ""))
      .filter(hasH1)
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("em components/, só o PageHeader e o PageHeading do admin têm <h1>", () => {
    const withH1 = tsxFiles(join(ROOT, "components")).filter(hasH1).map(rel).sort();
    expect(withH1).toEqual(["components/admin/page-heading.tsx", "components/page-header.tsx"]);
  });
});
