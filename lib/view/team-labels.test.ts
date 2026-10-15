import { describe, expect, it } from "vitest";

import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

import {
  alternateCode,
  CLUB_SHORT_NAMES,
  deriveCode,
  deriveDisplayName,
  displayTeamName,
  officialTeamName,
  TEAM_CODES,
  teamCode,
  WC_TEAM_LABELS_PT,
} from "./team-labels";

const CODE = /^[A-Z0-9]{3}$/;

describe("displayTeamName", () => {
  it("traduz seleção da Copa pra PT-BR", () => {
    expect(displayTeamName("Mexico", "wc")).toBe("México");
    expect(displayTeamName("South Korea", "wc")).toBe("Coreia do Sul");
    expect(displayTeamName("Germany", "wc")).toBe("Alemanha");
  });

  it("usa o nome curto curado em clube (#578)", () => {
    expect(displayTeamName("SE Palmeiras", "bsa")).toBe("Palmeiras");
    expect(displayTeamName("Real Madrid CF", "ucl")).toBe("Real Madrid");
    expect(displayTeamName("Club Atlético de Madrid", "laliga")).toBe("Atlético de Madrid");
    expect(displayTeamName("Paris Saint-Germain FC", "ucl")).toBe("PSG");
  });

  it("não traduz seleção fora da Copa", () => {
    expect(displayTeamName("Mexico", "bsa")).toBe("Mexico");
  });

  it("deriva o nome curto do clube fora do mapa", () => {
    expect(displayTeamName("Racing Club", "lib")).toBe("Racing");
    expect(displayTeamName("River Plate", "lib")).toBe("River Plate");
  });

  it("degrada pro canonical se a seleção não estiver mapeada", () => {
    expect(displayTeamName("Narnia", "wc")).toBe("Narnia");
  });

  it("não cai no protótipo do objeto", () => {
    expect(displayTeamName("constructor", "bsa")).toBe("constructor");
    expect(teamCode("constructor")).toMatch(CODE);
  });
});

describe("officialTeamName", () => {
  it("clube → canonical; Copa → PT-BR", () => {
    expect(officialTeamName("SE Palmeiras", "bsa")).toBe("SE Palmeiras");
    expect(officialTeamName("Mexico", "wc")).toBe("México");
  });
});

describe("mapas curados por liga (completude, formato, unicidade)", () => {
  for (const [league, teams] of Object.entries(CANONICAL_TEAMS)) {
    if (teams.length === 0) continue;
    const isWc = league === "world_cup";

    it(`${league}: todo time tem sigla curada de 3 caracteres, única na liga`, () => {
      const missing = teams.filter((t) => !(t in TEAM_CODES));
      expect(missing).toEqual([]);
      for (const t of teams) expect(TEAM_CODES[t]).toMatch(CODE);
      const codes = teams.map((t) => TEAM_CODES[t]);
      const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
      expect(dupes).toEqual([]);
    });

    it(`${league}: todo time tem nome curto dentro do teto`, () => {
      const map = isWc ? WC_TEAM_LABELS_PT : CLUB_SHORT_NAMES;
      const max = isWc ? 20 : 18;
      const missing = teams.filter((t) => !(t in map));
      expect(missing).toEqual([]);
      for (const t of teams) {
        expect(map[t].length).toBeGreaterThan(0);
        expect(map[t].length).toBeLessThanOrEqual(max);
      }
    });
  }

  it("regressão do 'AT': Atlético de Madrid e Athletic têm siglas diferentes", () => {
    expect(teamCode("Club Atlético de Madrid")).toBe("ATM");
    expect(teamCode("Athletic Club")).toBe("ATH");
  });

  it("sigla independe da liga (mesmo canonical, mesma sigla)", () => {
    expect(teamCode("Newcastle United FC")).toBe("NEW");
  });
});

describe("deriveCode", () => {
  it.each([
    ["River Plate", "RIV"],
    ["Boca Juniors", "BOC"],
    ["Racing Club", "RAC"],
    ["LDU de Quito", "LDU"],
    ["Atletico-MG", "AMG"],
    ["Palestino", "PAL"],
    ["Independiente del Valle", "IVA"],
    ["Universidad Catolica", "UCA"],
    ["Sporting Cristal", "SCR"],
    ["Peñarol", "PEN"],
  ])("%s → %s", (name, code) => {
    expect(deriveCode(name)).toBe(code);
  });

  it.each(["A", "FC", "FC SC", "", "Ñ", "Ó Á", "Bodø/Glimt", "12", "Real", "Real X"])(
    "sempre 3 caracteres [A-Z0-9] (%j)",
    (name) => {
      expect(deriveCode(name)).toMatch(CODE);
    },
  );
});

describe("deriveDisplayName", () => {
  it("tira afixo só nas pontas", () => {
    expect(deriveDisplayName("Club Atlético de Madrid")).toBe("Atlético de Madrid");
    expect(deriveDisplayName("Racing Club")).toBe("Racing");
    expect(deriveDisplayName("Club Nacional de Football")).toBe("Nacional de Football");
    expect(deriveDisplayName("Some FC Team")).toBe("Some FC Team");
  });

  it("nunca devolve vazio", () => {
    expect(deriveDisplayName("FC")).toBe("FC");
    expect(deriveDisplayName("FC SC")).toBe("FC SC");
    expect(deriveDisplayName("AC Om")).toBe("AC Om");
  });
});

describe("alternateCode", () => {
  it("Palestino com PAL tomado → PLS", () => {
    expect(alternateCode("Palestino", "PAL")).toBe("PLS");
  });

  it("nunca devolve a sigla tomada e sempre tem 3 caracteres", () => {
    for (const name of ["Palestino", "A", "Universidad de Chile", "Real Madrid CF"]) {
      const taken = teamCode(name);
      const alt = alternateCode(name, taken);
      expect(alt).not.toBe(taken);
      expect(alt).toMatch(CODE);
    }
  });
});

describe("WC_TEAM_LABELS_PT (completude)", () => {
  it("mapeia TODAS as 48 seleções de world_cup", () => {
    const missing = CANONICAL_TEAMS.world_cup.filter(
      (name) => !(name in WC_TEAM_LABELS_PT),
    );
    expect(missing).toEqual([]);
  });

  it("não tem chave órfã (toda chave do mapa é uma seleção canônica)", () => {
    const canonical = new Set(CANONICAL_TEAMS.world_cup);
    const orphans = Object.keys(WC_TEAM_LABELS_PT).filter(
      (name) => !canonical.has(name),
    );
    expect(orphans).toEqual([]);
  });

  it("todo label é não-vazio", () => {
    for (const label of Object.values(WC_TEAM_LABELS_PT)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
