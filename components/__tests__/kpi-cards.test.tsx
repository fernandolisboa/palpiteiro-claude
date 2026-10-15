import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KpiCards } from "@/components/dashboard/kpi-cards";
import type { DashboardKpiView } from "@/lib/view/dashboard";

const VIEW: DashboardKpiView = {
  yieldPct: { value: "5,2%", n: 32, lowSample: false },
  winRate: { value: "55%", n: 32, lowSample: false },
  passRate: { value: "40%", n: 50, lowSample: false },
  clvOddsRatio: { value: "+3,2%", n: 30, lowSample: false },
  clvNoVigDelta: { value: "+1,8 pp", n: 30, lowSample: false },
  yieldSigned: "+5,2%",
  yieldTone: "positive",
  totalProfit: "+2,56 u",
  profitPositive: true,
  profitTone: "positive",
  counts: { total: 50, bets: 32, passes: 18, settled: 32, pending: 0, won: 18, lost: 14, void: 0 },
};

describe("KpiCards", () => {
  it("full (padrão, admin): os quatro cartões e as contagens", () => {
    const html = renderToStaticMarkup(<KpiCards view={VIEW} />);
    for (const label of ["retorno", "taxa de acerto", "jogos sem aposta", "lucro total"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("+2,56 u");
    expect(html).toContain("50 predições");
  });

  it("technical (detalhe do Desempenho, #577): só jogos sem aposta e as contagens", () => {
    const html = renderToStaticMarkup(<KpiCards view={VIEW} variant="technical" />);
    expect(html).toContain("jogos sem aposta");
    expect(html).toContain("n=50");
    expect(html).toContain("50 predições");
    expect(html).not.toContain("retorno");
    expect(html).not.toContain("taxa de acerto");
    expect(html).not.toContain("lucro total");
    expect(html).not.toContain("+2,56 u");
  });
});
