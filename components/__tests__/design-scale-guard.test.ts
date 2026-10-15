import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Guarda da escala visual (ADR 0056). Varre o código de UI e de view; ignora
// testes e linhas de comentário (não vão pra tela). Pega só classes escritas numa
// linha: classes quebradas em várias linhas de cn()/cva escapam e ficam pra revisão.

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["__tests__", "node_modules"]);

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

function scan(match: (line: string, rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (isComment(line)) return;
          if (match(line, rel)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
  }
  return hits;
}

describe("escala visual (ADR 0056)", () => {
  it("muted-fg-2 nunca no texto de 11px (text-meta): ali vai muted-foreground", () => {
    const hits = scan(
      (line) => /\btext-meta\b/.test(line) && /(?<![\w:-])text-muted-fg-2\b/.test(line),
    );
    expect(hits).toEqual([]);
  });
});
