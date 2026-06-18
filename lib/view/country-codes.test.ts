import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

import { flagCodeForTeam, WC_FLAG_CODE } from "./country-codes";

describe("flagCodeForTeam", () => {
  it("retorna o código da bandeira pra seleção da Copa", () => {
    expect(flagCodeForTeam("Mexico", "wc")).toBe("mx");
    expect(flagCodeForTeam("South Korea", "wc")).toBe("kr");
    expect(flagCodeForTeam("England", "wc")).toBe("gb-eng");
    expect(flagCodeForTeam("Scotland", "wc")).toBe("gb-sct");
  });

  it("retorna undefined fora da Copa (clubes não têm bandeira nesta fase)", () => {
    expect(flagCodeForTeam("Mexico", "bsa")).toBeUndefined();
    expect(flagCodeForTeam("SE Palmeiras", "bsa")).toBeUndefined();
    expect(flagCodeForTeam("Real Madrid CF", "ucl")).toBeUndefined();
  });

  it("undefined pra seleção não mapeada", () => {
    expect(flagCodeForTeam("Narnia", "wc")).toBeUndefined();
  });
});

describe("WC_FLAG_CODE (completude + vendoring)", () => {
  it("mapeia TODAS as 48 seleções de world_cup", () => {
    const missing = CANONICAL_TEAMS.world_cup.filter(
      (name) => !(name in WC_FLAG_CODE),
    );
    expect(missing).toEqual([]);
  });

  it("não tem chave órfã (toda chave é uma seleção canônica)", () => {
    const canonical = new Set(CANONICAL_TEAMS.world_cup);
    const orphans = Object.keys(WC_FLAG_CODE).filter(
      (name) => !canonical.has(name),
    );
    expect(orphans).toEqual([]);
  });

  it("todo código tem um SVG vendorizado em public/flags/wc/", () => {
    const dir = join(process.cwd(), "public", "flags", "wc");
    const missingAssets = Object.values(WC_FLAG_CODE).filter(
      (code) => !existsSync(join(dir, `${code}.svg`)),
    );
    expect(missingAssets).toEqual([]);
  });
});
