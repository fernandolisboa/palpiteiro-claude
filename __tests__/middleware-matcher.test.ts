import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão do matcher de auth do middleware (SEO landmine, #439 /
 * report 06 achado #2).
 *
 * O matcher gateia (307→/signin) TODO path que NÃO cai na negative-lookahead. Uma
 * rota de metadata do Next adicionada sem emendar o lookahead — `/robots.txt`,
 * `/sitemap.xml` — some pros crawlers silenciosamente. Este teste trava as duas
 * exclusões novas E confirma que o app autenticado segue gateado.
 *
 * Lemos o matcher do SOURCE (readFileSync, como as irmãs auth.config/webauthn):
 * importar `@/middleware` executaria `NextAuth(authConfig)`. Reproduzimos a
 * semântica do Next ancorando a string do matcher com `^…$` — fiel pra esse
 * estilo de lookahead-negativo (o path casa o matcher ⇒ middleware roda ⇒ gateado).
 */

const source = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
const matcherMatch = source.match(/matcher:\s*\[\s*"([^"]+)"/);
if (!matcherMatch) {
  throw new Error("não achei o matcher em middleware.ts");
}
const matcher = matcherMatch[1];
const matcherRe = new RegExp(`^${matcher}$`);

/** Reproduz a decisão do Next: casou o matcher ⇒ middleware roda ⇒ rota gateada. */
function isGated(path: string): boolean {
  return matcherRe.test(path);
}

describe("middleware matcher — exclusões de SEO (#439)", () => {
  it("libera /robots.txt (rota de metadata do Next, sem sessão)", () => {
    expect(isGated("/robots.txt")).toBe(false);
  });

  it("libera /sitemap.xml (rota de metadata do Next, sem sessão)", () => {
    expect(isGated("/sitemap.xml")).toBe(false);
  });

  it("ancora as exclusões — /robots.txtfoo e /sitemap.xmlfoo seguem gateados", () => {
    expect(isGated("/robots.txtfoo")).toBe(true);
    expect(isGated("/sitemap.xmlfoo")).toBe(true);
  });
});

describe("middleware matcher — app autenticado segue gateado", () => {
  it.each(["/jogos", "/dashboard", "/match/123", "/perfil", "/admin"])(
    "gateia %s",
    (path) => {
      expect(isGated(path)).toBe(true);
    },
  );
});

describe("middleware matcher — superfícies públicas seguem liberadas", () => {
  it.each(["/", "/como-funciona", "/termos", "/privacidade", "/p/abc"])(
    "libera %s",
    (path) => {
      expect(isGated(path)).toBe(false);
    },
  );
});
