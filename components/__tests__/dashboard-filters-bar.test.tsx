import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardFiltersBar } from "@/components/dashboard/dashboard-filters";
import type { DashboardFilters } from "@/lib/dashboard/kpis";

const ALL: DashboardFilters = { status: "all", league: "all", market: "all" };
const MARKETS = [
  { key: "over_under", label: "Over/Under gols" },
  { key: "btts", label: "Ambas marcam" },
];

describe("DashboardFiltersBar — dimensions (#539)", () => {
  it("renderiza só os grupos pedidos", () => {
    const html = renderToStaticMarkup(
      <DashboardFiltersBar
        filters={ALL}
        leagues={["bsa", "ucl"]}
        markets={MARKETS}
        dimensions={["league", "market"]}
      />
    );
    expect(html).toContain(">liga<");
    expect(html).toContain(">mercado<");
    expect(html).not.toContain(">status<");
  });

  it("grupo com uma opção real some; sem grupo visível não renderiza nada", () => {
    const html = renderToStaticMarkup(
      <DashboardFiltersBar
        filters={ALL}
        leagues={["bsa"]}
        markets={[MARKETS[0]]}
        dimensions={["league", "market"]}
      />
    );
    expect(html).toBe("");
  });

  it("default mantém os três grupos", () => {
    const html = renderToStaticMarkup(
      <DashboardFiltersBar
        filters={ALL}
        leagues={["bsa", "ucl"]}
        markets={MARKETS}
      />
    );
    expect(html).toContain(">status<");
    expect(html).toContain(">liga<");
    expect(html).toContain(">mercado<");
  });

  it("filtro ativo segue visível mesmo com uma opção real só", () => {
    const html = renderToStaticMarkup(
      <DashboardFiltersBar
        filters={{ ...ALL, league: "bsa" }}
        leagues={["bsa"]}
        markets={[MARKETS[0]]}
        dimensions={["league", "market"]}
      />
    );
    expect(html).toContain(">liga<");
    expect(html).not.toContain(">mercado<");
  });
});
