import { describe, expect, it } from "vitest";

import {
  activeItemHref,
  ADMIN_NAV,
  ariaCurrentFor,
  HELP_NAV,
  isActivePath,
  navGroups,
  PRIMARY_NAV,
} from "@/lib/nav/menu";

describe("menu do app", () => {
  it("telas de uso na barra: jogos, suas apostas, bolão, desempenho", () => {
    expect(PRIMARY_NAV.map((i) => [i.label, i.href])).toEqual([
      ["jogos", "/jogos"],
      ["suas apostas", "/apostas"],
      ["bolão", "/bolao"],
      ["desempenho", "/dashboard"],
    ]);
  });

  it("admin só aparece pra admin; ajuda pra todos", () => {
    expect(navGroups(false).map((g) => g.id)).toEqual(["ajuda"]);
    expect(navGroups(true).map((g) => g.id)).toEqual(["ajuda", "admin"]);
  });
});

describe("isActivePath", () => {
  it("casa exato e por prefixo delimitado por /", () => {
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
    expect(isActivePath("/dashboard/123", "/dashboard")).toBe(true);
    expect(isActivePath("/dashboard-foo", "/dashboard")).toBe(false);
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/jogos", "/")).toBe(false);
  });

  it("ignora a query do href", () => {
    expect(isActivePath("/jogos", "/jogos?tour=1")).toBe(true);
  });
});

describe("activeItemHref", () => {
  it("o item mais específico vence", () => {
    expect(activeItemHref("/admin/users/abc", ADMIN_NAV.items)).toBe("/admin/users");
    expect(activeItemHref("/admin", ADMIN_NAV.items)).toBe("/admin");
  });

  it("detalhe fora da lista cai na visão geral do grupo", () => {
    expect(activeItemHref("/admin/predictions/xyz", ADMIN_NAV.items)).toBe("/admin");
  });

  it("link com query (rever o tour) nunca fica ativo", () => {
    expect(activeItemHref("/jogos", HELP_NAV.items)).toBeNull();
    expect(activeItemHref("/como-usar", HELP_NAV.items)).toBe("/como-usar");
  });

  it("fora do grupo, nada ativo", () => {
    expect(activeItemHref("/perfil", HELP_NAV.items)).toBeNull();
  });
});

describe("ariaCurrentFor", () => {
  it("page na própria tela, true na sub-tela da seção", () => {
    expect(ariaCurrentFor("/admin/users", "/admin/users")).toBe("page");
    expect(ariaCurrentFor("/admin/users/abc", "/admin/users")).toBe("true");
  });
});
