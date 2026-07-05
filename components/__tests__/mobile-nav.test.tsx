import { describe, expect, it, vi } from "vitest";

// `mobile-nav.tsx` importa `signOutAction` (-> `@/auth` -> next-auth), que não
// é carregável no ambiente de teste. Mockamos `@/auth` só pra permitir importar
// a função pura `mobileNavLinks`; este suite não exercita o logout.
vi.mock("@/auth", () => ({ signOut: vi.fn() }));

import { mobileNavLinks } from "@/components/mobile-nav";

describe("mobileNavLinks", () => {
  it("inclui o link de admin quando isAdmin é true", () => {
    const links = mobileNavLinks(true);
    expect(links.map((l) => l.href)).toEqual([
      "/jogos",
      "/apostas",
      "/dashboard",
      "/como-funciona",
      "/admin",
      "/perfil",
    ]);
    expect(links.some((l) => l.href === "/admin")).toBe(true);
    expect(links.some((l) => l.href === "/como-funciona")).toBe(true);
    expect(links.some((l) => l.href === "/perfil")).toBe(true);
  });

  it("não inclui o link de admin quando isAdmin é false", () => {
    const links = mobileNavLinks(false);
    expect(links.some((l) => l.href === "/admin")).toBe(false);
    // Jogos, dashboard e como-funciona sempre presentes (mesma nav do desktop).
    expect(links.some((l) => l.href === "/jogos")).toBe(true);
    expect(links.some((l) => l.href === "/dashboard")).toBe(true);
    expect(links.some((l) => l.href === "/como-funciona")).toBe(true);
    // Perfil sempre presente, independente de admin.
    expect(links.some((l) => l.href === "/perfil")).toBe(true);
  });
});
