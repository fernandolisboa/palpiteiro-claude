import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Regra de produto (#571/#574): nenhum nome de casa de apostas, e nenhum texto que
// mande o usuário "pra casa", em lugar nenhum da tela. Varre o código de UI e de
// view; ignora testes, prompts (lib/ai) e o texto legal de termos/privacidade, que
// tem regra própria (ADR 0048). Linhas de comentário não vão pra tela e ficam de fora.

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib/tour", "lib/view"];
const SKIP_DIRS = new Set(["__tests__", "node_modules"]);
const SKIP_PREFIXES = ["lib/ai/", "app/termos/", "app/privacidade/"];

const BOOKMAKER_NAME =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;
const HOUSE_COPY = /(odds?|margem) da (sua )?casa|na casa\b|das casas/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("{/*");
}

describe("nenhuma casa de apostas no texto da tela", () => {
  it("app/, components/, lib/tour e lib/view sem nome de casa nem 'odd da casa'", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (isComment(line)) return;
            if (BOOKMAKER_NAME.test(line) || HOUSE_COPY.test(line)) {
              hits.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
