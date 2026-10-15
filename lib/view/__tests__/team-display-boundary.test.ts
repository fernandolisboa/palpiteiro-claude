import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Fronteira do nome de exibição (#578): nome curto, sigla e escudo são SÓ de tela.
// Matching (odds, H2H, settlement, ratings, sync), prompts e chaves do banco leem o
// canonical (matches.home_team/away_team). Se um destes módulos importar o seam de
// time da view, o nome curto pode vazar para um caminho que não é exibição.

const ROOT = path.resolve(__dirname, "../../..");
const GUARDED_DIRS = [
  "lib/ai",
  "lib/odds",
  "lib/settlement",
  "lib/providers",
  "lib/ratings",
  "lib/sync",
  "lib/user-palpite",
  "lib/model-base",
  "lib/bets",
  "lib/pools",
  "lib/db",
  "db",
];
const SKIP_DIRS = new Set(["__tests__", "node_modules", "migrations"]);
const VIEW_TEAM_IMPORT = /["'](?:@\/lib\/view\/|(?:\.\.?\/)+(?:lib\/)?view\/)team(?:-labels)?["']/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
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

describe("fronteira do nome de exibição dos times", () => {
  it("nenhum módulo de matching, prompt, sync ou banco importa lib/view/team(-labels)", () => {
    const hits: string[] = [];
    for (const dir of GUARDED_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (VIEW_TEAM_IMPORT.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });

  it("o padrão pega os dois jeitos de importar", () => {
    expect(VIEW_TEAM_IMPORT.test('import { teamToTeam } from "@/lib/view/team";')).toBe(true);
    expect(VIEW_TEAM_IMPORT.test("import { teamCode } from '@/lib/view/team-labels';")).toBe(true);
    expect(VIEW_TEAM_IMPORT.test('import { x } from "../../view/team";')).toBe(true);
    expect(VIEW_TEAM_IMPORT.test('import { x } from "@/lib/view/types";')).toBe(false);
  });
});
