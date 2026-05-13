import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __setSportsDataProviderForTesting,
  FallbackProvider,
  ApiFootballAdapter,
  FootballDataOrgAdapter,
  getSportsDataProvider,
} from "@/lib/providers/sports-data/index";

const originalEnv = { ...process.env };

describe("getSportsDataProvider factory", () => {
  beforeEach(() => {
    __setSportsDataProviderForTesting(undefined);
    delete process.env.SPORTS_DATA_PRIMARY;
    delete process.env.SPORTS_DATA_FALLBACK;
  });
  afterEach(() => {
    __setSportsDataProviderForTesting(undefined);
    process.env = { ...originalEnv };
  });

  it("defaults to api-football primary + football-data-org fallback", () => {
    const p = getSportsDataProvider();
    expect(p).toBeInstanceOf(FallbackProvider);
    expect(p.capabilities.name).toBe(
      "fallback(api-football,football-data-org)",
    );
  });

  it("memoizes the instance across calls", () => {
    const a = getSportsDataProvider();
    const b = getSportsDataProvider();
    expect(a).toBe(b);
  });

  it("returns single adapter when primary === fallback", () => {
    process.env.SPORTS_DATA_PRIMARY = "football-data-org";
    process.env.SPORTS_DATA_FALLBACK = "football-data-org";
    const p = getSportsDataProvider();
    expect(p).toBeInstanceOf(FootballDataOrgAdapter);
  });

  it("respects SPORTS_DATA_PRIMARY override", () => {
    process.env.SPORTS_DATA_PRIMARY = "football-data-org";
    process.env.SPORTS_DATA_FALLBACK = "api-football";
    const p = getSportsDataProvider();
    expect(p.capabilities.name).toBe(
      "fallback(football-data-org,api-football)",
    );
  });

  it("throws on invalid provider name in env", () => {
    process.env.SPORTS_DATA_PRIMARY = "nonexistent-provider";
    expect(() => getSportsDataProvider()).toThrow(/Invalid sports-data provider/);
  });

  it("__setSportsDataProviderForTesting overrides the memoized instance", () => {
    const stub = new ApiFootballAdapter();
    __setSportsDataProviderForTesting(stub);
    expect(getSportsDataProvider()).toBe(stub);
  });
});
