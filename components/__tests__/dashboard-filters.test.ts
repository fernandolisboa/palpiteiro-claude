import { describe, expect, it } from "vitest";

import type { DashboardFilters } from "@/lib/dashboard/kpis";
import {
  buildDashboardHref,
  currentDashboardHref,
} from "@/components/dashboard/dashboard-filters";

const ALL: DashboardFilters = { status: "all", league: "all", market: "all" };

describe("buildDashboardHref", () => {
  it("sets a single dimension from a clean state", () => {
    expect(buildDashboardHref(ALL, "status", "won")).toBe(
      "/dashboard?status=won",
    );
  });

  it("preserves the other active dimensions", () => {
    const current: DashboardFilters = { ...ALL, league: "wc" };
    expect(buildDashboardHref(current, "status", "won")).toBe(
      "/dashboard?status=won&league=wc",
    );
  });

  it("clears a dimension when set back to 'all'", () => {
    const current: DashboardFilters = { status: "won", league: "wc", market: "all" };
    expect(buildDashboardHref(current, "status", "all")).toBe(
      "/dashboard?league=wc",
    );
  });

  it("returns the bare path when everything is 'all'", () => {
    expect(buildDashboardHref(ALL, "market", "all")).toBe("/dashboard");
  });

  it("honors a non-default basePath with a query string", () => {
    expect(buildDashboardHref(ALL, "status", "won", "/admin/users/u1")).toBe(
      "/admin/users/u1?status=won",
    );
  });

  it("returns the bare non-default basePath when everything is 'all'", () => {
    expect(buildDashboardHref(ALL, "market", "all", "/admin/users/u1")).toBe(
      "/admin/users/u1",
    );
  });
});

describe("currentDashboardHref com página (#577)", () => {
  it("omite a página 1 e leva as outras", () => {
    expect(currentDashboardHref(ALL, "/dashboard", 1)).toBe("/dashboard");
    expect(currentDashboardHref(ALL, "/dashboard", 2)).toBe("/dashboard?page=2");
    expect(currentDashboardHref({ ...ALL, league: "wc" }, "/dashboard", 3)).toBe(
      "/dashboard?league=wc&page=3",
    );
  });

  it("trocar qualquer filtro volta pra página 1", () => {
    // buildDashboardHref não carrega a página atual.
    expect(buildDashboardHref({ ...ALL, league: "wc" }, "status", "won")).toBe(
      "/dashboard?status=won&league=wc",
    );
  });
});
