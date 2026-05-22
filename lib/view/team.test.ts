import { describe, expect, it } from "vitest";

import { teamToTeam } from "./team";

describe("teamToTeam", () => {
  it("returns hue + short from static map for canonical teams", () => {
    const t = teamToTeam("SE Palmeiras");
    expect(t.name).toBe("SE Palmeiras");
    expect(t.short).toBe("PAL");
    expect(t.hue).toBe(145);
  });

  it("maps Champions league teams correctly", () => {
    const t = teamToTeam("Real Madrid CF");
    expect(t.short).toBe("RMA");
    expect(t.hue).toBe(240);
  });

  it("derives short for teams outside the static map", () => {
    const t = teamToTeam("Some Random Team");
    expect(t.name).toBe("Some Random Team");
    expect(t.short.length).toBeGreaterThanOrEqual(1);
    expect(t.short).toMatch(/^[A-Z0-9]+$/);
    expect(t.hue).toBeGreaterThanOrEqual(0);
    expect(t.hue).toBeLessThan(360);
  });

  it("hue from hash is deterministic", () => {
    expect(teamToTeam("Foo").hue).toBe(teamToTeam("Foo").hue);
  });
});
