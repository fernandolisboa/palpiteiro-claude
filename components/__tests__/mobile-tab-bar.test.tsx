import { describe, expect, it } from "vitest";

import { moreSheetSections } from "@/components/nav/mobile-tab-bar";
import { PRIMARY_NAV } from "@/lib/nav/menu";

describe("barra de abas do celular (#633)", () => {
  it("as quatro telas de uso viram abas, com rótulo curto onde precisa", () => {
    expect(PRIMARY_NAV.map((i) => i.shortLabel ?? i.label)).toEqual([
      "jogos",
      "apostas",
      "bolão",
      "desempenho",
    ]);
  });

  it("o \"mais\" do admin tem ajuda, visão geral e as quatro seções", () => {
    const more = moreSheetSections(true);
    expect(more.help.map((i) => i.href)).toEqual([
      "/como-usar",
      "/como-funciona",
      "/jogos?tour=1",
    ]);
    expect(more.admin?.overview.href).toBe("/admin");
    expect(more.admin?.sections.map((i) => i.href)).toEqual([
      "/admin/ia",
      "/admin/motor",
      "/admin/leagues",
      "/admin/users",
    ]);
  });

  it("quem não é admin não vê o admin no \"mais\"", () => {
    expect(moreSheetSections(false).admin).toBeNull();
  });
});
