import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getMarketPresentation } from "./presentation";

describe("getMarketPresentation", () => {
  it("over_under: outcome label composes seed label + linha; frase leiga verbatim", () => {
    const p = getMarketPresentation("over_under");
    expect(p.marketKey).toBe("over_under");
    expect(p.marketLabel).toBe("Over/Under gols");
    expect(p.defaultLine).toBe(2.5);
    expect(p.selectionLabel("over")).toBe("Over");
    expect(p.selectionLabel("under")).toBe("Under");
    expect(p.outcomeLabel("over", 2.5)).toBe("Over 2.5");
    expect(p.outcomeLabel("under", 2.5)).toBe("Under 2.5");
    // sem linha → só o label da seleção (defensivo).
    expect(p.outcomeLabel("over", null)).toBe("Over");
    expect(p.betSummary("over", 2.5)).toEqual({
      market: "Mais de 2.5 gols",
      plain: "pelo menos 3 gols no jogo",
    });
    expect(p.betSummary("under", 2.5)).toEqual({
      market: "Menos de 2.5 gols",
      plain: "no máximo 2 gols no jogo",
    });
    expect(p.framingLabel("over", 2.5)).toBe("pelo menos 3 gols");
    expect(p.framingLabel("under", 2.5)).toBe("menos de 3 gols");
    expect(p.settlementMetricLabel).toBe("gols (90')");
    // cut do over/under: total > linha → "over" (3 gols na linha 2.5).
    expect(p.classifyH2H?.(2, 1, 2.5)).toBe("over");
    expect(p.classifyH2H?.(1, 1, 2.5)).toBe("under");
  });

  it("match_result: labels home/draw/away, sem linha, sem lente de gols", () => {
    const p = getMarketPresentation("match_result");
    expect(p.defaultLine).toBeNull();
    expect(p.selectionLabel("home")).toBe("Casa");
    expect(p.outcomeLabel("draw", null)).toBe("Empate");
    expect(p.outcomeLabel("away", null)).toBe("Fora");
    expect(p.classifyH2H).toBeNull();
  });

  it("lança em mercado desconhecido (bug de chamada, não degrada)", () => {
    expect(() => getMarketPresentation("nope")).toThrow(
      /unknown market presentation/,
    );
  });

  it("é seguro pro bundle do cliente: sem import de @/lib/ai, @/lib/db ou market-descriptor", () => {
    // Guard-test do inegociável de bundle do cliente (#170 importa este módulo
    // num componente "use client"). Converte a convenção num teste que falha.
    // Caminho relativo à raiz do pacote (cwd do vitest). Olha só os ESPECIFICADORES
    // de `from "…"` (não comentários, que citam esses paths de propósito).
    const src = readFileSync("lib/view/markets/presentation.ts", "utf8");
    const specifiers = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(specifiers.some((s) => s.startsWith("@/lib/ai"))).toBe(false);
    expect(specifiers.some((s) => s.startsWith("@/lib/db"))).toBe(false);
    expect(specifiers.some((s) => s.includes("market-descriptor"))).toBe(false);
  });
});
