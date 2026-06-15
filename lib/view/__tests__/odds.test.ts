import { describe, expect, it } from "vitest";

import { toNwayOddsView } from "@/lib/view/odds";

describe("toNwayOddsView — card N-vias (1X2) (#173 PR-2)", () => {
  it("recomputa probs+overround do mercado completo (Σ=1), labels do registry, ordem preservada", () => {
    const v = toNwayOddsView(
      {
        bookmaker: "Pinnacle",
        capturedAt: new Date("2026-05-15T10:00:00Z"),
        selections: [
          { key: "home", odd: "2.100" },
          { key: "draw", odd: "3.400" },
          { key: "away", odd: "3.200" },
        ],
      },
      "match_result",
      new Date("2026-05-15T10:05:00Z"),
    );
    expect(v.marketLabel).toBe("Resultado (1X2)");
    expect(v.outcomes).toEqual([
      { label: "Casa", odd: "2.10", pct: "44.0%" },
      { label: "Empate", odd: "3.40", pct: "27.2%" },
      { label: "Fora", odd: "3.20", pct: "28.9%" },
    ]);
    // SCALING pin (#173 blocker): overround vem RE-DERIVADO das odds (~8.3%),
    // NUNCA do overroundPct armazenado (string em percent) nem inflado 100x.
    expect(v.overround).toBe("8.3%");
    expect(v.bookmaker).toBe("Pinnacle");
    expect(typeof v.updatedAgo).toBe("string");
  });

  it("Number() no boundary: odds string do Drizzle não caem em string-math", () => {
    const v = toNwayOddsView(
      {
        bookmaker: "Bet365",
        capturedAt: new Date("2026-05-15T10:00:00Z"),
        selections: [
          { key: "home", odd: "1.500" },
          { key: "draw", odd: "4.000" },
          { key: "away", odd: "7.000" },
        ],
      },
      "match_result",
    );
    // 1/1.5 domina → implícita do favorito > 55% (só certo com Number() aplicado;
    // string-math daria NaN/lixo). As 3 implícitas somam ~100% (Σ=1, partição).
    const pcts = v.outcomes.map((o) => Number(o.pct.replace("%", "")));
    expect(pcts[0]).toBeGreaterThan(55);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    expect(v.outcomes.map((o) => o.label)).toEqual(["Casa", "Empate", "Fora"]);
  });
});
