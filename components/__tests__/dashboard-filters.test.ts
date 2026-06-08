import { describe, expect, it } from "vitest";

import type { DashboardFilters } from "@/lib/dashboard/kpis";
import { buildDashboardHref } from "@/components/dashboard/dashboard-filters";

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
});
