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

describe("DashboardFiltersBar — largura no celular (#574)", () => {
  it("cada grupo rola dentro do próprio nav e as pílulas não encolhem", () => {
    const html = renderToStaticMarkup(
      <DashboardFiltersBar
        filters={ALL}
        leagues={["bsa", "ucl", "epl", "laliga"]}
        markets={MARKETS}
      />
    );
    const navs = html.match(/<nav class="[^"]*"/g) ?? [];
    expect(navs).toHaveLength(3);
    for (const nav of navs) {
      expect(nav).toContain("overflow-x-auto");
      expect(nav).toContain("max-w-full");
    }
    const links = html.match(/<a [^>]*class="[^"]*"/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain("shrink-0");
      expect(link).toContain("whitespace-nowrap");
    }
    // Rótulos sem mudança.
    expect(html).toContain(">Green<");
  });
});
