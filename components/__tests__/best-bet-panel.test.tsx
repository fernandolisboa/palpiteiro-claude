import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A renderização do card em si é de AnalysisResult (testada à parte); aqui só
// importam label/badge/ordem/erros do painel. Mock leve evita stubs de AnalysisView.
vi.mock("@/components/analysis-result", () => ({
  AnalysisResult: () => <div data-testid="analysis" />,
}));

import {
  BestBetResults,
  sortBestBetEntries,
  type BestBetSortMode,
} from "@/components/best-bet-results";
import type { BestBetEntry, BestBetRank, BestBetView } from "@/lib/view/types";

function entry(
  marketKey: string,
  marketLabel: string,
  rank: Partial<BestBetRank>,
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
  const A = entry("over_under", "O/U", { edgePct: 8, evPerUnit: 0.1, confidencePct: 60 });
  const B = entry("btts", "BTTS", { edgePct: 5, evPerUnit: 0.2, confidencePct: 70 });
  const C = entry("match_result", "1X2", { edgePct: 3, evPerUnit: 0.05, confidencePct: 52 });
  const P = entry("double_chance", "DC", { edgePct: 12, evPerUnit: 0.3, isPass: true });

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

  it("normaliza edge por impliedSumTarget: dupla chance Σ2 não domina cru", () => {
    const ou = entry("over_under", "O/U", { edgePct: 6, impliedSumTarget: 1 });
    const dc = entry("double_chance", "DC", { edgePct: 10, impliedSumTarget: 2 }); // 10/2=5 < 6
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
    for (const input of [[x, y], [y, x]] as BestBetEntry[][]) {
      expect(keys(sortBestBetEntries(input, "edge"))).toEqual(["alpha", "zebra"]);
    }
    // ev diferente desempata antes do marketKey.
    const hi = entry("zebra", "Z", { edgePct: 5, evPerUnit: 0.3 });
    expect(keys(sortBestBetEntries([y, hi], "edge"))[0]).toBe("zebra");
  });

  it("não muta o array de entrada", () => {
    const input = [entry("a", "A", { edgePct: 1 }), entry("b", "B", { edgePct: 2 })];
    const before = keys(input);
    sortBestBetEntries(input, "edge");
    expect(keys(input)).toEqual(before);
  });
});

describe("BestBetResults — render", () => {
  const view: BestBetView = {
    entries: [
      entry("match_result", "Resultado (1X2)", { edgePct: 3, evPerUnit: 0.05 }),
      entry("over_under", "Over/Under gols", { edgePct: 8, evPerUnit: 0.1 }),
    ],
    errors: [{ marketKey: "btts", marketLabel: "Ambas marcam", message: "Nenhum bookmaker oferece este mercado" }],
    llmCalls: 2,
    unavailableMarkets: 1,
  };

  it("destaca o #1 (edge default) com badge 'Melhor aposta' e mostra os labels na ordem ranqueada", () => {
    const html = renderToStaticMarkup(<BestBetResults view={view} />);
    expect(html).toContain("Melhor aposta");
    // #1 por edge = over_under (8) deve vir ANTES de match_result (3).
    expect(html.indexOf("Over/Under gols")).toBeLessThan(
      html.indexOf("Resultado (1X2)"),
    );
  });

  it("renderiza o header com contagem de análises e indisponíveis", () => {
    const html = renderToStaticMarkup(<BestBetResults view={view} />);
    expect(html).toContain("2 análises geradas");
    expect(html).toContain("1 mercado indisponível");
  });

  it("lista os mercados indisponíveis (label + mensagem)", () => {
    const html = renderToStaticMarkup(<BestBetResults view={view} />);
    expect(html).toContain("Ambas marcam");
    expect(html).toContain("Nenhum bookmaker oferece este mercado");
  });

  it("os 3 modos de ordenação estão presentes; edge é o ativo (aria-pressed)", () => {
    const html = renderToStaticMarkup(<BestBetResults view={view} />);
    for (const label of ["Edge", "EV", "Edge × confiança"]) {
      expect(html).toContain(label);
    }
    // edge ativo por default.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Edge</);
  });

  it("renderiza o marketLabel ACIMA de um card PASS (load-bearing)", () => {
    const passView: BestBetView = {
      entries: [entry("match_result", "Resultado (1X2)", { isPass: true })],
      errors: [],
      llmCalls: 1,
      unavailableMarkets: 0,
    };
    const html = renderToStaticMarkup(<BestBetResults view={passView} />);
    expect(html).toContain("Resultado (1X2)");
  });
});

// Garante que o union de modos não regrediu silenciosamente.
const _modes: BestBetSortMode[] = ["edge", "ev", "edgeConf"];
void _modes;
