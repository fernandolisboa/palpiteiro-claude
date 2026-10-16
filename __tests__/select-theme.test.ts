// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Lista aberta dos selects nativos no tema escuro: a cor vem de UMA regra global em
 * app/globals.css. Antes cada componente punha `bg-popover text-popover-foreground`
 * nas próprias <option> (ou esquecia, e a lista abria branca com texto claro). Este
 * teste trava a regra global e proíbe a volta das correções por componente.
 */

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" || entry === "__tests__"
        ? []
        : tsxFiles(full);
    }
    return entry.endsWith(".tsx") && !entry.endsWith(".test.tsx") ? [full] : [];
  });
}

type Offense = { file: string; line: number; tag: string; attr: string };

/** Atributos de cor/tema nas tags <select>/<Select>/<option>/<optgroup> de um fonte TSX. */
function offensesIn(file: string, source: string): Offense[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: Offense[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      for (const attr of node.attributes.properties) {
        const text = attr.getText(sf);
        const name = ts.isJsxAttribute(attr) ? attr.name.getText(sf) : "";
        const line =
          sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1;
        // <option>/<optgroup> só levam cor pro popup nativo — e a cor é global.
        const optionColor =
          (tag === "option" || tag === "optgroup") &&
          (name === "className" || name === "style");
        // color-scheme por select traria de volta o destaque azul-claro ilegível.
        const selectScheme =
          (tag === "select" || tag === "Select") && /color-?scheme/i.test(text);
        if (optionColor || selectScheme)
          found.push({ file, line, tag, attr: text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("selects nativos: tema da lista aberta é global", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const base = css.match(/@layer base\s*\{[\s\S]*?\n\}/g)?.join("\n") ?? "";

  it("globals.css define select/option/optgroup com os tokens do tema", () => {
    expect(base).toMatch(/\bselect\s*\{[^}]*color-scheme:\s*light;/);
    expect(base).toMatch(
      /\bselect\s*\{[^}]*scrollbar-color:\s*var\(--border-strong\)\s+var\(--popover\);/
    );
    expect(base).toMatch(
      /option,\s*optgroup\s*\{[^}]*background-color:\s*var\(--popover\);[^}]*color:\s*var\(--popover-foreground\);/
    );
    expect(base).toMatch(
      /option:disabled\s*\{[^}]*color:\s*var\(--muted-foreground\);/
    );
  });

  it("nenhuma regra fora do @layer base mexe em cor de select/option", () => {
    // CSS sem camada vence qualquer camada: uma regra solta reabriria o bug.
    const unlayered = css.replace(/@layer base\s*\{[\s\S]*?\n\}/g, "");
    const rules = [...unlayered.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const offending = rules.filter(
      ([, selector, body]) =>
        /\b(select|option|optgroup)\b/.test(selector) &&
        /(^|[\s;])(color|background(-color)?|color-scheme)\s*:/.test(body)
    );
    expect(offending.map(([rule]) => rule.trim())).toEqual([]);
  });

  it("nenhum componente repete cor nas <option> nem color-scheme no select", () => {
    const files = [
      ...tsxFiles(join(ROOT, "app")),
      ...tsxFiles(join(ROOT, "components")),
    ];
    expect(files.length).toBeGreaterThan(50);
    const offenses = files.flatMap((f) =>
      offensesIn(relative(ROOT, f), readFileSync(f, "utf8"))
    );
    expect(offenses).toEqual([]);
  });

  it("o primitivo Select não carrega color-scheme próprio", () => {
    const primitive = readFileSync(
      join(ROOT, "components/ui/select.tsx"),
      "utf8"
    );
    expect(primitive).not.toMatch(/color-scheme:/);
  });

  it("o detector pega as correções por componente que o teste proíbe", () => {
    const source = `
      export const A = () => (
        <Select onChange={(e) => e} className="[color-scheme:dark]">
          <option value="a" className="bg-popover text-popover-foreground">a</option>
          <optgroup label="g" style={{ color: "red" }} />
          <option value="b">b</option>
        </Select>
      );`;
    expect(offensesIn("amostra.tsx", source).map((o) => o.tag)).toEqual([
      "Select",
      "option",
      "optgroup",
    ]);
  });
});
