import { describe, expect, it } from "vitest";

import { DEFAULT_MATCH_TAB, MATCH_TAB_IDS, parseMatchTab } from "@/lib/view/match-tabs";

describe("parseMatchTab (#576)", () => {
  it("aceita os ids das abas", () => {
    for (const id of MATCH_TAB_IDS) expect(parseMatchTab(id)).toBe(id);
  });

  it("inválido, ausente ou repetido (array) cai em Mercados", () => {
    expect(DEFAULT_MATCH_TAB).toBe("mercados");
    expect(parseMatchTab("lixo")).toBe("mercados");
    expect(parseMatchTab("Dados")).toBe("mercados");
    expect(parseMatchTab(undefined)).toBe("mercados");
    expect(parseMatchTab(["dados", "mercados"])).toBe("mercados");
  });
});
