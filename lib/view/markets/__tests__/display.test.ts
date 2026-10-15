import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  displayCategoryLabel,
  displayMarketLabel,
  findDisplayPresentation,
  getDisplayPresentation,
} from "@/lib/view/markets/display";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

const TEAMS = { home: "Palmeiras", away: "Flamengo" };

describe("display — vocabulário de tela (ADR 0056)", () => {
  it("over/under: Total de gols · Mais de 2,5 · Menos de 2,5", () => {
    const p = getDisplayPresentation("over_under");
    expect(p.marketLabel).toBe("Total de gols");
    expect(p.selectionLabel("over")).toBe("Mais de");
    expect(p.selectionLabel("under")).toBe("Menos de");
    expect(p.outcomeLabel("over", 2.5)).toBe("Mais de 2,5");
    expect(p.outcomeLabel("under", 3.5)).toBe("Menos de 3,5");
    expect(p.outcomeLabel("over", null)).toBe("Mais de");
    expect(p.scenarioLabel("over", 2.5)).toBe("mais de 2,5 gols");
    expect(p.scenarioLabel("under", null)).toBe("menos de 2,5 gols");
    expect(p.betSummary("over", 2.5)).toEqual({
      market: "Mais de 2,5 gols",
      plain: "pelo menos 3 gols no jogo",
    });
    expect(p.betSummary("under", 1.5).market).toBe("Menos de 1,5 gols");
    // A frase leiga do framing não muda.
    expect(p.framingLabel("over", 2.5)).toBe("pelo menos 3 gols");
  });

  it("1X2 compõe com o nome dos times", () => {
    const p = getDisplayPresentation("match_result", TEAMS);
    expect(p.marketLabel).toBe("Resultado (1X2)");
    expect(p.outcomeLabel("home", null)).toBe("Palmeiras");
    expect(p.outcomeLabel("draw", null)).toBe("Empate");
  });

  it("btts e dupla chance sem mudança fora dos times", () => {
    expect(getDisplayPresentation("btts").selectionLabel("yes")).toBe("Sim");
    expect(getDisplayPresentation("btts").marketLabel).toBe("Ambas marcam");
    expect(getDisplayPresentation("double_chance", TEAMS).selectionLabel("home_or_draw")).toBe(
      "Palmeiras ou empate",
    );
  });

  it("a presentation do registry (seed, texto do modelo) fica intacta", () => {
    getDisplayPresentation("over_under", TEAMS);
    const raw = getMarketPresentation("over_under");
    expect(raw.marketLabel).toBe("Over/Under gols");
    expect(raw.selectionLabel("over")).toBe("Over");
    expect(raw.outcomeLabel("over", 2.5)).toBe("Over 2.5");
  });

  it("findDisplayPresentation não lança em mercado sem apresentação", () => {
    expect(findDisplayPresentation("nope")).toBeNull();
    expect(findDisplayPresentation("over_under")?.marketLabel).toBe("Total de gols");
  });

  it("displayMarketLabel e displayCategoryLabel: só o over/under muda", () => {
    expect(displayMarketLabel("over_under", "Over/Under gols")).toBe("Total de gols");
    expect(displayMarketLabel("btts", "Ambas marcam")).toBe("Ambas marcam");
    expect(displayCategoryLabel("Over/Under gols")).toBe("Total de gols");
    expect(displayCategoryLabel("Resultado (1X2)")).toBe("Resultado (1X2)");
  });

  it("é seguro pro bundle do cliente: sem import de @/lib/ai, @/lib/db ou market-descriptor", () => {
    const src = readFileSync("lib/view/markets/display.ts", "utf8");
    const specifiers = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.some((s) => s.startsWith("@/lib/ai"))).toBe(false);
    expect(specifiers.some((s) => s.startsWith("@/lib/db"))).toBe(false);
    expect(specifiers.some((s) => s.includes("market-descriptor"))).toBe(false);
  });
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("fronteira lib/ai ↛ vocabulário de tela", () => {
  it("nenhum arquivo de lib/ai importa display.ts diretamente", () => {
    const offenders = tsFiles("lib/ai").filter((f) =>
      /from\s+["']@\/lib\/view\/markets\/display["']/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("o texto do modelo segue lendo getMarketPresentation do presentation.ts", () => {
    for (const f of ["lib/ai/predict.ts", "lib/ai/palpites/synthesis-input.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(
        /import\s*\{[^}]*\bgetMarketPresentation\b[^}]*\}\s*from\s*["']@\/lib\/view\/markets\/presentation["']/,
      );
    }
  });
});
