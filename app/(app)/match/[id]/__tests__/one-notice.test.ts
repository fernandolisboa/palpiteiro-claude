// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
import { RISK_DISCLAIMER } from "@/lib/view/share/disclaimer";

// Um aviso por tela na página do jogo (ADR 0057). Fonte, não render: trava QUEM renderiza
// cada aviso, pra uma mudança futura não espalhar de novo o §3 nem a linha de análise.
// - §3 completo: só no registro de apostas (components/bet-slip.tsx), no painel e, no
//   celular, abaixo da grade;
// - ANALYSIS_RISK_DISCLAIMER: uma linha no "Ler análise completa" (full-analysis.tsx);
//   os cartões de análise dentro dele não repetem.

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const count = (src: string, sub: string | RegExp) =>
  typeof sub === "string" ? src.split(sub).length - 1 : (src.match(sub) ?? []).length;

// Tudo o que a página do jogo monta, fora o registro de apostas.
const PAGE_FILES = [
  "app/(app)/match/[id]/page.tsx",
  "components/palpites/palpite-area.tsx",
  "components/palpites/palpite-hero.tsx",
  "components/full-analysis.tsx",
  "components/market-analysis-section.tsx",
  "components/previous-analyses.tsx",
  "components/seu-palpite.tsx",
  "components/seu-palpite-section.tsx",
  "components/bet-slip-section.tsx",
  "components/match-odds-cards.tsx",
  "components/odds-card.tsx",
  "components/match-model-reading.tsx",
  "components/match-hero.tsx",
  "components/match-sections.tsx",
  "components/match-sections-auxiliary.tsx",
];

describe("§3 completo: só no registro de apostas", () => {
  it.each(PAGE_FILES)("%s não renderiza o §3", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/RISK_DISCLAIMER_PT_BR/);
    expect(code).not.toContain("nunca para recuperar perdas");
    expect(code).not.toContain(RISK_DISCLAIMER);
  });

  it("components/bet-slip.tsx renderiza o §3 no painel e, só no celular, abaixo da grade", () => {
    const code = stripComments(read("components/bet-slip.tsx"));
    expect(count(code, /\{RISK_DISCLAIMER_PT_BR\}/g)).toBe(2);
    // A linha abaixo da grade some no desktop, onde o painel com o §3 está ao lado.
    expect(code).toMatch(/<p className="[^"]*\blg:hidden\b[^"]*">\s*\{RISK_DISCLAIMER_PT_BR\}/);
  });
});

describe("linha de risco da análise: uma por análise aberta", () => {
  it("full-analysis.tsx renderiza UMA linha e desliga a dos cartões", () => {
    const code = stripComments(read("components/full-analysis.tsx"));
    expect(count(code, "{ANALYSIS_RISK_DISCLAIMER}")).toBe(1);
    expect(count(code, "showRiskDisclaimer={false}")).toBe(2);
  });

  it("market-analysis-section.tsx e previous-analyses.tsx repassam showRiskDisclaimer", () => {
    for (const file of ["components/market-analysis-section.tsx", "components/previous-analyses.tsx"]) {
      const code = stripComments(read(file));
      expect(code, file).toMatch(/<AnalysisResult[^>]*showRiskDisclaimer=\{showRiskDisclaimer\}/);
      expect(code, file).not.toContain("ANALYSIS_RISK_DISCLAIMER");
    }
  });

  it("a página não monta a linha por conta própria", () => {
    const code = stripComments(read("app/(app)/match/[id]/page.tsx"));
    expect(code).not.toContain("ANALYSIS_RISK_DISCLAIMER");
    expect(code).not.toContain(ANALYSIS_RISK_DISCLAIMER);
  });
});
