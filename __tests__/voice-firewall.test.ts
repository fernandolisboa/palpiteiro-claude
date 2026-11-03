// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Tom de mesa de amigos (ADR 0070). As telas que brincam (bolão, Suas apostas, vazios
 * de /jogos, landing) usam gíria de futebol, turfe e bar, mas a lista "Fora" não
 * entra nunca: "bet" (inglês e marca das casas) e o que soa como promessa ou convite
 * a apostar mais. O teste lê só o texto de tela (strings e texto JSX), não os
 * identificadores do código, por isso `const bet = …` não conta.
 */

const ROOT = process.cwd();

// Superfícies com o tom. Arquivo novo de bolão/apostas entra sozinho pelas pastas.
const DIRS = ["app/(app)/bolao", "app/(app)/apostas", "components/landing"];
const FILES = [
  "components/friend-pool-forms.tsx",
  "lib/view/range-href.ts",
  "lib/view/match-search.ts",
  "app/landing-content.tsx",
];

const FORA: Array<[string, RegExp]> = [
  ["bet", /(^|[\s"'`>(])bets?([\s.,!?:;"'`<)]|$)/i],
  ["barbada", /barbada/i],
  ["garantido", /garantid[oa]s?/i],
  ["bora recuperar", /bora recuperar|recupera(r)? o preju/i],
  ["revanche", /revanche/i],
  ["dobrar a aposta", /dobr(a|e|ar) a aposta/i],
  ["all-in", /all[\s-]?in/i],
  ["forrar", /\bforr(ar|ou|a)\b/i],
];

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      return entry === "__tests__" ? [] : walk(rel);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [rel] : [];
  });
}

/** Texto de tela aproximado: literais de string e texto entre tags JSX, sem comentários. */
function screenText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const strings = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...strings, ...jsx].filter((t) => /\s/.test(t.trim()) || /^[A-ZÁÉÍÓÚ]/.test(t.trim()));
}

const files = [...DIRS.flatMap(walk), ...FILES];

describe("firewall de vocabulário do tom (ADR 0070)", () => {
  it("varre um conjunto não vazio de arquivos", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file}: nada da lista Fora`, () => {
      const texts = screenText(readFileSync(join(ROOT, file), "utf8"));
      for (const [name, rx] of FORA) {
        const hit = texts.find((t) => rx.test(t));
        expect(hit, `"${name}" em ${file}`).toBeUndefined();
      }
    });
  }

  it("o detector pega o que deve pegar", () => {
    const [, bet] = FORA[0];
    expect(bet.test("pega essa bet?")).toBe(true);
    expect(bet.test("Bet do dia")).toBe(true);
    expect(bet.test("bet-slip")).toBe(false);
    expect(bet.test("alfabeto")).toBe(false);
  });
});
