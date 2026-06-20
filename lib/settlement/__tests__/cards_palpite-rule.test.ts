import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleCardsPalpite } from "@/lib/settlement/rules/cards_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

// rd com yellowCardsTotal já setado (a regra NÃO extrai — só compara `>= line`).
function rd(yellowCardsTotal: number | undefined): PalpiteResultData {
  const base: PalpiteResultData = {
    homeScore: 1,
    awayScore: 1,
    totalGoals: 2,
  };
  if (yellowCardsTotal !== undefined) base.yellowCardsTotal = yellowCardsTotal;
  return base;
}

describe("settleCardsPalpite — total de amarelos >= line", () => {
  it("count 5 >= line 4 → won", () => {
    expect(settleCardsPalpite({ line: 4, scope: "total" }, rd(5))).toBe("won");
  });

  it("count exatamente na linha (4 >= 4) → won (limite inclusivo)", () => {
    expect(settleCardsPalpite({ line: 4, scope: "total" }, rd(4))).toBe("won");
  });

  it("count 3 < line 4 → lost", () => {
    expect(settleCardsPalpite({ line: 4, scope: "total" }, rd(3))).toBe("lost");
  });

  it("count 6 >= line 6 → won", () => {
    expect(settleCardsPalpite({ line: 6, scope: "total" }, rd(6))).toBe("won");
  });

  it("count 5 < line 6 → lost", () => {
    expect(settleCardsPalpite({ line: 6, scope: "total" }, rd(5))).toBe("lost");
  });

  it("0 amarelos < line 4 → lost (não fabrica, há dado)", () => {
    expect(settleCardsPalpite({ line: 4, scope: "total" }, rd(0))).toBe("lost");
  });
});

describe("settleCardsPalpite — prefer skip over silent wrong settle", () => {
  it("yellowCardsTotal undefined → throw → PENDING (nunca fabrica)", () => {
    expect(() =>
      settleCardsPalpite({ line: 4, scope: "total" }, rd(undefined)),
    ).toThrow(SettlementError);
  });
});

describe("settleCardsPalpite — params pinados a {4,6} × total", () => {
  it("line 5 (fora das rungs do projeto) → throw, nunca liquida contra linha sem sentido", () => {
    expect(() =>
      settleCardsPalpite({ line: 5, scope: "total" }, rd(5)),
    ).toThrow(SettlementError);
  });

  it("scope 'partial' (não 'total') → throw", () => {
    expect(() =>
      settleCardsPalpite({ line: 4, scope: "partial" }, rd(5)),
    ).toThrow(SettlementError);
  });

  it("params malformados (sem line) → throw", () => {
    expect(() => settleCardsPalpite({ scope: "total" }, rd(5))).toThrow(
      SettlementError,
    );
  });

  it("params null → throw", () => {
    expect(() => settleCardsPalpite(null, rd(5))).toThrow(SettlementError);
  });
});
