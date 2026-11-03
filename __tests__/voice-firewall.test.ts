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
const DIRS = ["app/(app)/bolao", "app/(app)/apostas", "components/landing", "components/bets"];
const FILES = [
  "components/friend-pool-forms.tsx",
  "lib/view/friend-pool.ts",
  "lib/view/range-href.ts",
  "lib/view/match-search.ts",
  "app/landing-content.tsx",
];

const FORA: Array<[string, RegExp]> = [
  // Fronteira por letra/dígito/hífen: "bet-slip" e "alfabeto" passam; o "." antes deixa
  // passar o ".bet.br" dos Termos (fora das superfícies, mas a regra é a mesma).
  ["bet", /(?<![\p{L}\p{N}./-])bets?(?![\p{L}\p{N}/-])/iu],
  ["barbada", /barbada/i],
  ["garantido", /garantid[oa]s?/i],
  ["bora recuperar", /bora recuperar|recupera(r)? o preju/i],
  ["revanche", /revanche/i],
  ["dobrar a aposta", /dobr\w* (a|as|o) (apostas?|valor)/i],
  ["all-in", /\ball[\s-]?in\b/i],
  ["forrar", /\bforr\w*/i],
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

/**
 * Texto de tela aproximado: literais de string ("…", '…', `…`) e texto JSX, sem
 * comentários. O texto JSX vai de `>` ou `}` até `<` ou `{`, então
 * `<p>Pega essa bet {x}</p>` também é lido.
 */
export function screenText(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const strings = [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " "),
  );
  // Texto JSX: de um `>` que fecha tag (colado no nome, atributo ou `}`, ou sozinho no
  // começo da linha, como o Prettier quebra) até o `<` seguinte. As expressões `{…}` no
  // meio saem, as strings dentro delas já entram pelo passo de cima.
  const jsx = [...code.matchAll(/(?:(?<=[\w"'}/])|(?<=^[ \t]*))>([^<>]+)</gm)].map((m) =>
    m[1].replace(/\{[^{}]*\}/g, " "),
  );
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
    expect(bet.test("“Pega essa bet”")).toBe(true);
    expect(bet.test("bet-slip")).toBe(false);
    expect(bet.test("alfabeto")).toBe(false);
    expect(bet.test("casa autorizada (.bet.br)")).toBe(false);
  });

  it("a extração de texto lê os formatos que o código usa", () => {
    const hit = (src: string) => screenText(src).some((t) => FORA[0][1].test(t));
    expect(hit("<p>Pega essa bet {name}</p>")).toBe(true);
    expect(hit("const x = 'Pega essa bet';")).toBe(true);
    expect(hit("const x = `Pega essa bet ${n}`;")).toBe(true);
    expect(hit('<p>{"Pega essa bet"}</p>')).toBe(true);
    expect(hit("<p>\n  Pega essa\n  bet\n</p>")).toBe(true);
    // Código, não tela.
    expect(hit("if (n > 0 && bets.length < 5) return;")).toBe(false);
    expect(hit("const bet = poolBetShortLabel(e.kind);")).toBe(false);
    expect(hit("const label = `${kind} · ${bet}`;")).toBe(false);
    expect(hit('import { SlipCard } from "@/components/bets/slip-card";')).toBe(false);
    expect(hit('<div className="transition-all inline-flex" />')).toBe(false);
  });
});
