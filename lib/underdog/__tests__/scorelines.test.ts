import { describe, expect, it } from "vitest";

import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { underdogScorelines } from "@/lib/underdog/scorelines";

describe("underdogScorelines", () => {
  it("as 3 células de vitória do azarão, em ordem de p, com 1 casa", () => {
    const m = scorelineMatrix(1.4, 1.0, { rho: -0.1 });
    const out = underdogScorelines(m, "away");
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.away > s.home)).toBe(true);
    expect(out[0]).toMatchObject({ home: 0, away: 1 });
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].pct).toBeGreaterThanOrEqual(out[i].pct);
    }
    expect(out[0].pct).toBe(Math.round(m.cells[0][1] * 1000) / 10);
  });

  it("espelho casa/fora", () => {
    const a = underdogScorelines(scorelineMatrix(1.4, 1.0), "away");
    const h = underdogScorelines(scorelineMatrix(1.0, 1.4), "home");
    expect(h).toEqual(
      a.map((s) => ({ home: s.away, away: s.home, pct: s.pct }))
    );
  });
});
