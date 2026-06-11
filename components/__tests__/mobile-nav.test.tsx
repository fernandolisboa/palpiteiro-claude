import { describe, expect, it } from "vitest";

import { mobileNavLinks } from "@/components/mobile-nav";

describe("mobileNavLinks", () => {
  it("inclui o link de admin quando isAdmin é true", () => {
    const links = mobileNavLinks(true);
    expect(links.map((l) => l.href)).toEqual(["/", "/dashboard", "/admin"]);
    expect(links.some((l) => l.href === "/admin")).toBe(true);
  });

  it("não inclui o link de admin quando isAdmin é false", () => {
    const links = mobileNavLinks(false);
    expect(links.some((l) => l.href === "/admin")).toBe(false);
    // Jogos e dashboard sempre presentes (mesma nav do desktop).
    expect(links.some((l) => l.href === "/")).toBe(true);
    expect(links.some((l) => l.href === "/dashboard")).toBe(true);
  });
});
