import { describe, expect, it, vi } from "vitest";

// `mobile-nav.tsx` importa `signOutAction` (-> `@/auth` -> next-auth), que não
// é carregável no ambiente de teste. Mockamos `@/auth` só pra permitir importar
// a função pura `mobileNavSections`; este suite não exercita o logout.
vi.mock("@/auth", () => ({ signOut: vi.fn() }));

import { mobileNavSections } from "@/components/mobile-nav";

function hrefs(isAdmin: boolean) {
  return mobileNavSections(isAdmin).map((s) => [s.id, s.items.map((i) => i.href)]);
}

describe("mobileNavSections", () => {
  it("mostra principal, ajuda, admin e conta pro admin, nessa ordem", () => {
    expect(hrefs(true)).toEqual([
      ["principal", ["/jogos", "/apostas", "/bolao", "/dashboard"]],
      ["ajuda", ["/como-usar", "/como-funciona", "/jogos?tour=1"]],
      [
        "admin",
        [
          "/admin",
          "/admin/ia",
          "/admin/motor",
          "/admin/leagues",
          "/admin/users",
        ],
      ],
      ["conta", ["/perfil"]],
    ]);
  });

  it("esconde a seção de admin de quem não é admin", () => {
    const sections = mobileNavSections(false);
    expect(sections.map((s) => s.id)).toEqual(["principal", "ajuda", "conta"]);
    expect(
      sections.flatMap((s) => s.items).some((i) => i.href.startsWith("/admin"))
    ).toBe(false);
  });
});
