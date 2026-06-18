import { describe, expect, it } from "vitest";

import { teamToTeam } from "./team";

describe("teamToTeam", () => {
  it("returns hue + short from static map for canonical teams", () => {
    const t = teamToTeam("SE Palmeiras", "bsa");
    expect(t.name).toBe("SE Palmeiras");
    expect(t.short).toBe("PAL");
    expect(t.hue).toBe(145);
  });

  it("maps Champions league teams correctly", () => {
    const t = teamToTeam("Real Madrid CF", "ucl");
    expect(t.short).toBe("RMA");
    expect(t.hue).toBe(240);
  });

  it("derives short for teams outside the static map", () => {
    const t = teamToTeam("Some Random Team", "bsa");
    expect(t.name).toBe("Some Random Team");
    expect(t.short.length).toBeGreaterThanOrEqual(1);
    expect(t.short).toMatch(/^[A-Z0-9]+$/);
    expect(t.hue).toBeGreaterThanOrEqual(0);
    expect(t.hue).toBeLessThan(360);
  });

  it("hue from hash is deterministic", () => {
    expect(teamToTeam("Foo", "bsa").hue).toBe(teamToTeam("Foo", "bsa").hue);
  });

  it("traduz o nome da seleção na Copa (display-only), short/hue no canonical", () => {
    const t = teamToTeam("Mexico", "wc");
    expect(t.name).toBe("México");
    // short/hue derivam do canonical EN — não da tradução.
    expect(t.short).toBe("MEX");
    expect(t.hue).toBe(teamToTeam("Mexico", "bsa").hue);
  });

  it("não traduz o mesmo nome fora da Copa (clubes passam verbatim)", () => {
    expect(teamToTeam("Mexico", "bsa").name).toBe("Mexico");
  });

  it("anexa flagCode na Copa; undefined em clubes (#341)", () => {
    expect(teamToTeam("Mexico", "wc").flagCode).toBe("mx");
    expect(teamToTeam("South Korea", "wc").flagCode).toBe("kr");
    expect(teamToTeam("SE Palmeiras", "bsa").flagCode).toBeUndefined();
  });
});
