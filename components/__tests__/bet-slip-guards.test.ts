import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { RISK_DISCLAIMER_PT_BR } from "@/lib/view/bet-slip";
import { RISK_DISCLAIMER } from "@/lib/view/share/disclaimer";

// Guards de fonte do registro de apostas (#556): disclaimer §3 completo (ADR 0034 §12 /
// ADR 0048), nada de "Apostar"/"cupom" na UI e nenhum caminho de bet-slip pro boundary
// público /p (ADR 0034 §13).

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// Remove comentários de bloco (inclui `{/* … */}` do JSX) e de linha. O `//` só conta
// como comentário no começo da linha ou depois de espaço, pra não comer "https://".
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

// Texto canônico do §3 (docs/ops/05-legal-compliance.md:102-105), sem o markdown.
const CANONICAL_RISK =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

function localConstant(src: string, name: string): string | null {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\n?\\s*"([^"]+)"`).exec(src);
  return m ? m[1] : null;
}

const COMPONENT = "components/bet-slip.tsx";

describe("disclaimer de risco §3 (ADR 0034 §12, ADR 0048)", () => {
  it("o canônico do código bate com o texto do doc de compliance", () => {
    expect(RISK_DISCLAIMER).toBe(CANONICAL_RISK);
  });

  it("RISK_DISCLAIMER_PT_BR de lib/view/bet-slip é o §3 completo, verbatim", () => {
    expect(RISK_DISCLAIMER_PT_BR).toBe(RISK_DISCLAIMER);
  });

  it("o doc de compliance contém o mesmo texto (fonte do verbatim)", () => {
    const doc = read("docs/ops/05-legal-compliance.md")
      .replace(/\*\*/g, "")
      .replace(/\n>\s*/g, " ")
      .replace(/\s+/g, " ");
    expect(doc).toContain(CANONICAL_RISK);
  });

  it(`${COMPONENT} renderiza {RISK_DISCLAIMER_PT_BR} e a constante é o §3 verbatim`, () => {
    const src = read(COMPONENT);
    const code = stripComments(src);
    expect(code).toMatch(/\{\s*RISK_DISCLAIMER_PT_BR\s*\}/);
    // O componente ("use client") guarda uma cópia local de propósito (não puxa o
    // firewall/módulos de servidor pro bundle); a cópia não pode driftar.
    const local = localConstant(src, "RISK_DISCLAIMER_PT_BR");
    if (local !== null) {
      expect(local).toBe(RISK_DISCLAIMER);
    } else {
      expect(src).toMatch(
        /import\s*\{[^}]*\bRISK_DISCLAIMER_PT_BR\b[^}]*\}\s*from\s*["']@\/lib\/view\/bet-slip["']/
      );
    }
  });
});

describe("histórico /apostas também carrega o §3 verbatim", () => {
  it("app/(app)/apostas/page.tsx renderiza a constante e ela não driftou", () => {
    const src = read("app/(app)/apostas/page.tsx");
    expect(stripComments(src)).toMatch(/\{\s*RISK_DISCLAIMER_PT_BR\s*\}/);
    const local = localConstant(src, "RISK_DISCLAIMER_PT_BR");
    if (local !== null) expect(local).toBe(RISK_DISCLAIMER);
  });
});

describe(`${COMPONENT} — copy da UI`, () => {
  const code = stripComments(read(COMPONENT));

  it('o submit diz "Registrar apostas"', () => {
    expect(code).toContain('"Registrar apostas"');
    expect(code).toMatch(
      /<Button\s+type="submit"[\s\S]{0,200}?"Registrar apostas"/
    );
  });

  it('nenhum botão "Apostar" (nem string literal "Apostar")', () => {
    expect(code).not.toMatch(/>\s*Apostar\b/);
    expect(code).not.toMatch(/["'`]\s*Apostar\b/);
    expect(code).not.toMatch(/\bapostar\b/i);
  });

  it('a palavra "cupom" não aparece na UI', () => {
    expect(code).not.toMatch(/cupom/i);
  });

  it("a remoção de comentários não esconde o código (sanidade)", () => {
    expect(code).toContain("registerBetSlip");
    expect(code).not.toContain('nunca "Apostar"');
  });
});

describe("boundary público /p não importa nada do registro de apostas (ADR 0034 §13)", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) && !full.includes("__tests__")
        ? [full]
        : [];
    });
  }

  const FORBIDDEN = [
    /from\s+["'][^"']*bet-slip[^"']*["']/,
    /from\s+["']@\/lib\/bets\//,
    /from\s+["'][^"']*evaluate-slip["']/,
    /from\s+["'][^"']*slip-schema["']/,
    /from\s+["'][^"']*analysis-probs["']/,
    /from\s+["'][^"']*queries\/user-bets["']/,
    /from\s+["'][^"']*reference-odds["']/,
  ];

  it("app/p/[id]/page.tsx e opengraph-image.tsx existem", () => {
    expect(() => read("app/p/[id]/page.tsx")).not.toThrow();
    expect(() => read("app/p/[id]/opengraph-image.tsx")).not.toThrow();
  });

  it("nenhum arquivo sob app/p/** importa módulos do bet-slip", () => {
    const files = walk(join(root, "app", "p"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${relative(root, f)} casa ${re}`).toBe(false);
      }
    }
  });
});
