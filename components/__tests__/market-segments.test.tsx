import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MarketSegments } from "@/components/dashboard/market-segments";
import type { MarketSegmentView } from "@/lib/view/dashboard";

function segment(
  overrides: Partial<MarketSegmentView> = {},
): MarketSegmentView {
  return {
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    empty: false,
    kpis: {
      yieldPct: { value: "+8%", n: 32, lowSample: false },
      winRate: { value: "55%", n: 32, lowSample: false },
      passRate: { value: "40%", n: 50, lowSample: false },
      totalProfit: "+2.56 u",
      profitPositive: true,
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
    },
    graduation: {
      resolved: 32,
      target: 30,
      graduated: true,
      label: "32 / 30 resolvidas",
    },
    stakeBands: [
      { band: "1u", yieldPct: { value: "+5%", n: 20, lowSample: false }, profit: "+1.00 u" },
      { band: "2u", yieldPct: { value: "+12%", n: 8, lowSample: true }, profit: "+1.92 u" },
      { band: "3u", yieldPct: { value: "—", n: 0, lowSample: false }, profit: "+0.00 u" },
    ],
    ...overrides,
  };
}

describe("MarketSegments", () => {
  it("renders nothing when there are no segments", () => {
    expect(renderToStaticMarkup(<MarketSegments segments={[]} />)).toBe("");
  });

  it("renders the D9 ruler with the graduated badge and the stake bands", () => {
    const html = renderToStaticMarkup(
      <MarketSegments segments={[segment()]} />,
    );
    expect(html).toContain("Over/Under gols");
    // régua D9 visível
    expect(html).toContain("32 / 30 resolvidas");
    expect(html).toContain("graduado");
    // breakdown por banda de stake
    expect(html).toContain("1u");
    expect(html).toContain("2u");
    expect(html).toContain("3u");
    expect(html).toContain("+5%");
    expect(html).toContain("+12%");
  });

  it("shows 'graduando' (not graduated) when below the threshold", () => {
    const html = renderToStaticMarkup(
      <MarketSegments
        segments={[
          segment({
            graduation: {
              resolved: 12,
              target: 30,
              graduated: false,
              label: "12 / 30 resolvidas",
            },
          }),
        ]}
      />,
    );
    expect(html).toContain("12 / 30 resolvidas");
    expect(html).toContain("graduando");
    expect(html).not.toContain("graduado");
  });

  it("degrades an empty segment to a clear no-data state", () => {
    const html = renderToStaticMarkup(
      <MarketSegments segments={[segment({ empty: true })]} />,
    );
    expect(html).toContain("Sem apostas resolvidas ainda");
    // a régua/bandas não renderizam quando vazio
    expect(html).not.toContain("32 / 30 resolvidas");
  });
});
