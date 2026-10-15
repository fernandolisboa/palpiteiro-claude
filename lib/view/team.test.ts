import { describe, expect, it } from "vitest";

import { teamPair, teamToTeam } from "./team";

describe("teamToTeam", () => {
  it("returns short name, official name, hue + code for canonical teams", () => {
    const t = teamToTeam("SE Palmeiras", "bsa");
    expect(t.name).toBe("Palmeiras");
    expect(t.fullName).toBe("SE Palmeiras");
    expect(t.short).toBe("PAL");
    expect(t.hue).toBe(145);
  });

  it("maps Champions league teams correctly", () => {
    const t = teamToTeam("Real Madrid CF", "ucl");
    expect(t.name).toBe("Real Madrid");
    expect(t.short).toBe("RMA");
    expect(t.hue).toBe(240);
  });

  it("derives name and 3-letter code for teams outside the static map", () => {
    const t = teamToTeam("Some Random Team", "bsa");
    expect(t.name).toBe("Some Random Team");
    expect(t.fullName).toBe("Some Random Team");
    expect(t.short).toMatch(/^[A-Z0-9]{3}$/);
    expect(t.hue).toBeGreaterThanOrEqual(0);
    expect(t.hue).toBeLessThan(360);
  });

  it("hue from hash is deterministic", () => {
    expect(teamToTeam("Foo", "bsa").hue).toBe(teamToTeam("Foo", "bsa").hue);
  });

  it("traduz o nome da seleção na Copa (display-only), short/hue no canonical", () => {
    const t = teamToTeam("Mexico", "wc");
    expect(t.name).toBe("México");
    expect(t.fullName).toBe("México");
    // short/hue derivam do canonical EN — não da tradução.
    expect(t.short).toBe("MEX");
    expect(t.hue).toBe(teamToTeam("Mexico", "bsa").hue);
  });

  it("sigla FIFA de 3 letras na Copa (antes 'SK')", () => {
    expect(teamToTeam("South Korea", "wc").short).toBe("KOR");
    expect(teamToTeam("Bosnia & Herzegovina", "wc").short).toBe("BIH");
  });

  it("não traduz o mesmo nome fora da Copa", () => {
    expect(teamToTeam("Mexico", "bsa").name).toBe("Mexico");
  });

  it("anexa flagCode na Copa; undefined em clubes (#341)", () => {
    expect(teamToTeam("Mexico", "wc").flagCode).toBe("mx");
    expect(teamToTeam("South Korea", "wc").flagCode).toBe("kr");
    expect(teamToTeam("SE Palmeiras", "bsa").flagCode).toBeUndefined();
  });
});

describe("teamPair", () => {
  it("sem colisão não mexe em nada", () => {
    const { home, away } = teamPair("Club Atlético de Madrid", "Athletic Club", "laliga");
    expect(home).toEqual(teamToTeam("Club Atlético de Madrid", "laliga"));
    expect(away).toEqual(teamToTeam("Athletic Club", "laliga"));
    expect([home.short, away.short]).toEqual(["ATM", "ATH"]);
  });

  it("Palmeiras × Palestino: a sigla curada fica, a derivada troca (os dois mandos)", () => {
    const a = teamPair("Palmeiras", "Palestino", "lib");
    expect(a.home.short).toBe("PAL");
    expect(a.away.short).toBe("PLS");
    const b = teamPair("Palestino", "Palmeiras", "lib");
    expect(b.home.short).toBe("PLS");
    expect(b.away.short).toBe("PAL");
  });

  it("dois derivados que colidem: troca a do visitante", () => {
    const { home, away } = teamPair("Nacional", "Club Nacional", "lib");
    expect(home.short).toBe("NAC");
    expect(away.short).toBe("NCN");
    expect(away.short).toMatch(/^[A-Z0-9]{3}$/);
  });
});
