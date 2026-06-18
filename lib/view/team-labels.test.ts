import { describe, expect, it } from "vitest";

import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

import { displayTeamName, WC_TEAM_LABELS_PT } from "./team-labels";

describe("displayTeamName", () => {
  it("traduz seleção da Copa pra PT-BR", () => {
    expect(displayTeamName("Mexico", "wc")).toBe("México");
    expect(displayTeamName("South Korea", "wc")).toBe("Coreia do Sul");
    expect(displayTeamName("Germany", "wc")).toBe("Alemanha");
  });

  it("passa o canonical verbatim fora da Copa (clubes não traduzem)", () => {
    expect(displayTeamName("SE Palmeiras", "bsa")).toBe("SE Palmeiras");
    expect(displayTeamName("Real Madrid CF", "ucl")).toBe("Real Madrid CF");
    // Mesmo um nome que existe no mapa da Copa não é traduzido sob outra liga.
    expect(displayTeamName("Mexico", "bsa")).toBe("Mexico");
  });

  it("degrada pro canonical se a seleção não estiver mapeada", () => {
    expect(displayTeamName("Narnia", "wc")).toBe("Narnia");
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
