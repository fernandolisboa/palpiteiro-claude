import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAST_PERFORMANCE_NOTE, SummaryCards } from "@/components/dashboard/summary-cards";
import type { DashboardKpiView } from "@/lib/view/dashboard";

function view(over: Partial<DashboardKpiView> = {}): DashboardKpiView {
  return {
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
    counts: {
      total: 50,
      bets: 32,
      passes: 18,
      settled: 32,
      pending: 0,
      won: 18,
      lost: 14,
      void: 0,
    },
    ...over,
  };
}

const render = (v: DashboardKpiView) => renderToStaticMarkup(<SummaryCards view={v} />);

// Classe do <span> do valor de um cartão.
function valueClass(html: string, value: string): string {
  const escaped = value.replace(/[+]/g, "\\+");
  return html.match(new RegExp(`<span class="([^"]*)">${escaped}</span>`))?.[1] ?? "";
}

describe("SummaryCards (/dashboard, #577)", () => {
  it("três cartões: retorno com sinal, taxa de acerto e saldo; sem n=", () => {
    const html = render(view());
    expect(html).toContain("retorno");
    expect(html).toContain("taxa de acerto");
    expect(html).toContain("saldo");
    expect(html).not.toContain("lucro total");
    expect(html).toContain("+5,2%");
    expect(html).not.toContain("n=");
    expect(html).toContain("em 32 apostas liquidadas");
    // A amostra aparece uma vez só.
    expect(html.split("apostas liquidadas").length - 1).toBe(1);
  });

  it("a frase dos Termos §4", () => {
    expect(PAST_PERFORMANCE_NOTE).toBe("Desempenho passado não garante desempenho futuro.");
    expect(render(view())).toContain(PAST_PERFORMANCE_NOTE);
  });

  it("amostra pequena escrita quando lowSample", () => {
    expect(render(view())).not.toContain("amostra pequena");
    const html = render(view({ yieldPct: { value: "5,2%", n: 4, lowSample: true } }));
    expect(html).toContain("amostra pequena");
    expect(html).toContain("em 4 apostas liquidadas");
  });

  it("cor pelo tom da view: positivo verde, negativo vermelho, zero neutro", () => {
    let html = render(view());
    expect(valueClass(html, "+5,2%")).toContain("text-edge-fg");
    expect(valueClass(html, "+2,56 u")).toContain("text-edge-fg");
    expect(valueClass(html, "55%")).not.toMatch(/text-edge-fg|text-destructive/);

    html = render(
      view({ yieldSigned: "-3,0%", yieldTone: "negative", totalProfit: "-1,20 u", profitTone: "negative" }),
    );
    expect(valueClass(html, "-3,0%")).toContain("text-destructive");
    expect(valueClass(html, "-1,20 u")).toContain("text-destructive");

    html = render(view({ totalProfit: "0,00 u", profitTone: "zero" }));
    expect(valueClass(html, "0,00 u")).not.toMatch(/text-edge-fg|text-destructive/);
  });

  it("sem aposta liquidada: retorno e saldo '—' neutros, sem 'em 0 apostas liquidadas'", () => {
    const html = render(
      view({
        yieldPct: { value: "—", n: 0, lowSample: false },
        winRate: { value: "—", n: 0, lowSample: false },
        yieldSigned: "—",
        yieldTone: "zero",
        totalProfit: "0,00 u",
        profitTone: "zero",
      }),
    );
    expect(valueClass(html, "—")).toContain("text-muted-foreground");
    // Retorno, taxa de acerto e saldo: os três "—".
    expect(html.split(">—</span>").length - 1).toBe(3);
    expect(html).not.toContain("0,00 u");
    expect(html).not.toContain("liquidada");
    expect(html).toContain(PAST_PERFORMANCE_NOTE);
  });
});
