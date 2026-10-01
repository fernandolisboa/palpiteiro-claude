import { describe, expect, it } from "vitest";

import { sortBestBetEntries } from "@/lib/view/best-bet-sort";
import type { BestBetEntry, BestBetRank } from "@/lib/view/types";

function entry(
  marketKey: string,
  marketLabel: string,
  rank: Partial<BestBetRank>
): BestBetEntry {
  return {
    marketKey,
    marketLabel,
    analysis: {} as never,
    rank: {
      edgePct: 0,
      evPerUnit: 0,
      confidencePct: 50,
      oddAtRecommendation: 2,
      impliedSumTarget: 1,
      isPass: false,
      ...rank,
    },
  };
}

const keys = (es: BestBetEntry[]) => es.map((e) => e.marketKey);

describe("sortBestBetEntries — ordenação por modo (#178)", () => {
  const A = entry("over_under", "O/U", {
    edgePct: 8,
    evPerUnit: 0.1,
    confidencePct: 60,
  });
  const B = entry("btts", "BTTS", {
    edgePct: 5,
    evPerUnit: 0.2,
    confidencePct: 70,
  });
  const C = entry("match_result", "1X2", {
    edgePct: 3,
    evPerUnit: 0.05,
    confidencePct: 52,
  });
  const P = entry("double_chance", "DC", {
    edgePct: 12,
    evPerUnit: 0.3,
    isPass: true,
  });

  it("edge (default): desc por edge normalizado; pass por último", () => {
    expect(keys(sortBestBetEntries([C, P, A, B], "edge"))).toEqual([
      "over_under",
      "btts",
      "match_result",
      "double_chance", // pass afunda apesar do edge 'alto'
    ]);
  });

  it("EV: desc por evPerUnit; pass por último", () => {
    expect(keys(sortBestBetEntries([A, B, C, P], "ev"))).toEqual([
      "btts", // 0.20
      "over_under", // 0.10
      "match_result", // 0.05
      "double_chance",
    ]);
  });

  it("edge × confiança: pondera o edge pela confiança", () => {
    // A: 8×60=480 ; B: 5×70=350 ; C: 3×52=156
    expect(keys(sortBestBetEntries([C, B, A], "edgeConf"))).toEqual([
      "over_under",
      "btts",
      "match_result",
    ]);
  });

  it("edge × confiança: NÃO normaliza a confiança (dupla chance Σ2 não é penalizada em dobro)", () => {
    // edge normalizado igual (5); DC tem confiança MAIOR → deve vir na frente.
    // Bug do impliedSumTarget²: DC viraria 5×(90/2)=225 < OU 5×80=400 e seria demovida.
    const dc = entry("double_chance", "DC", {
      edgePct: 10,
      impliedSumTarget: 2,
      confidencePct: 90,
    }); // edge norm = 5 ; edgeConf = 5×90 = 450
    const ou = entry("over_under", "O/U", {
      edgePct: 5,
      impliedSumTarget: 1,
      confidencePct: 80,
    }); // edge norm = 5 ; edgeConf = 5×80 = 400
    expect(keys(sortBestBetEntries([ou, dc], "edgeConf"))).toEqual([
      "double_chance",
      "over_under",
    ]);
  });

  it("normaliza edge por impliedSumTarget: dupla chance Σ2 não domina cru", () => {
    const ou = entry("over_under", "O/U", { edgePct: 6, impliedSumTarget: 1 });
    const dc = entry("double_chance", "DC", {
      edgePct: 10,
      impliedSumTarget: 2,
    }); // 10/2=5 < 6
    expect(keys(sortBestBetEntries([dc, ou], "edge"))).toEqual([
      "over_under",
      "double_chance",
    ]);
  });

  it("não-pass com chave null fica ENTRE os não-pass (acima dos passes), nunca afundado junto", () => {
    const noEdge = entry("btts", "BTTS", { edgePct: null, evPerUnit: null });
    const good = entry("over_under", "O/U", { edgePct: 7, evPerUnit: 0.1 });
    const pass = entry("match_result", "1X2", { isPass: true });
    expect(keys(sortBestBetEntries([pass, noEdge, good], "edge"))).toEqual([
      "over_under", // melhor não-pass
      "btts", // não-pass sem edge: abaixo do bom, ACIMA do pass
      "match_result", // pass por último
    ]);
  });

  it("tiebreak determinístico (EV/unidade, depois marketKey): #1 estável vs ordem de entrada", () => {
    // edges iguais; ev iguais → desempata por marketKey alfabético.
    const x = entry("zebra", "Z", { edgePct: 5, evPerUnit: 0.1 });
    const y = entry("alpha", "A", { edgePct: 5, evPerUnit: 0.1 });
    for (const input of [
      [x, y],
      [y, x],
    ] as BestBetEntry[][]) {
      expect(keys(sortBestBetEntries(input, "edge"))).toEqual([
        "alpha",
        "zebra",
      ]);
    }
    // ev diferente desempata antes do marketKey.
    const hi = entry("zebra", "Z", { edgePct: 5, evPerUnit: 0.3 });
    expect(keys(sortBestBetEntries([y, hi], "edge"))[0]).toBe("zebra");
  });

  it("não muta o array de entrada", () => {
    const input = [
      entry("a", "A", { edgePct: 1 }),
      entry("b", "B", { edgePct: 2 }),
    ];
    const before = keys(input);
    sortBestBetEntries(input, "edge");
    expect(keys(input)).toEqual(before);
  });
});
