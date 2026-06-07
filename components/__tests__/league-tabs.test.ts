import { describe, expect, it } from "vitest";

import { visibleLeagueTabs } from "@/components/league-tabs";

describe("visibleLeagueTabs", () => {
  it("retorna só a aba da Copa quando 'wc' é a única ativa", () => {
    const tabs = visibleLeagueTabs(["wc"]);
    expect(tabs.map((t) => t.value)).toEqual(["wc"]);
  });

  it("não inclui a aba 'Todos' quando há só uma liga ativa", () => {
    const tabs = visibleLeagueTabs(["wc"]);
    expect(tabs.some((t) => t.value === "all")).toBe(false);
  });

  it("inclui a aba 'Todos' quando há mais de uma liga ativa", () => {
    const tabs = visibleLeagueTabs(["wc", "bsa"]);
    expect(tabs.some((t) => t.value === "all")).toBe(true);
  });
});
