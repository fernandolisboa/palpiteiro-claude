import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regressão da auditoria de segurança 2026-11-01: o layout do /admin não basta como
// gate — o App Router pode renderizar só o segmento da página (navegação RSC) sem
// re-rodar o layout. Toda page.tsx do admin checa o role por conta própria.
const ADMIN_DIR = join(process.cwd(), "app/(app)/admin");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

describe("admin pages — role check na própria página", () => {
  const all = pages(ADMIN_DIR);

  it("acha as páginas do admin", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it.each(all.map((p) => [p.slice(ADMIN_DIR.length) || "/"]))(
    "%s checa role !== \"admin\" → notFound()",
    (rel) => {
      const src = readFileSync(join(ADMIN_DIR, rel), "utf8");
      expect(src).toMatch(/role !== "admin"\)\s*notFound\(\)/);
    },
  );
});
