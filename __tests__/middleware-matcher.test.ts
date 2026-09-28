import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
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
// O capture vem dos BYTES do source: um `\.` escrito na string TS aparece aqui
// como `\\.`. Desfaz o escape de string (como o TS faria) antes de compilar,
// senão o `\\` viraria backslash literal na regex.
// `getMiddlewareMatchers` é o compilador de matcher do próprio Next (usado no build), mas
// não sai no .d.ts público — tipamos só a parte que o teste usa.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: string[], config: object) => { regexp: string }[];
};

const matcher = matcherMatch[1].replace(/\\\\/g, "\\");
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

  it("escapa o ponto — /robotsXtxt e /sitemapXxml seguem gateados", () => {
    expect(isGated("/robotsXtxt")).toBe(true);
    expect(isGated("/sitemapXxml")).toBe(true);
  });
});

describe("middleware matcher — app autenticado segue gateado", () => {
  it.each(["/jogos", "/dashboard", "/match/123", "/perfil", "/admin", "/time/palmeiras"])(
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

describe("middleware matcher — raiz redireciona quem está logado", () => {
  // A landing `/` fica FORA do gate (1ª entrada), mas volta ao middleware por uma 2ª
  // entrada exata `"/"` pra que o usuário logado vá pra /jogos em vez de ver "Entrar".
  // Compila TODAS as entradas com o próprio Next (mesma função do build), então o teste
  // é comportamental: não depende da formatação do source.
  const block = source.match(/matcher:\s*\[([\s\S]*?)\n\s*\],/)?.[1] ?? "";
  const entries = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\\\/g, "\\"),
  );
  const compiled = getMiddlewareMatchers(entries, {}).map(
    (m) => new RegExp(m.regexp),
  );
  const runsMiddleware = (path: string) => compiled.some((re) => re.test(path));

  it("tem duas entradas (gate + raiz exata)", () => {
    expect(entries).toHaveLength(2);
    expect(entries[1]).toBe("/");
  });

  it.each(["/", "/?_rsc=abc"])("o middleware roda em %s", (path) => {
    expect(runsMiddleware(path)).toBe(true);
  });

  it.each(["/como-funciona", "/termos", "/privacidade", "/p/abc", "/signin"])(
    "a raiz não abre o middleware pra outra página pública (%s)",
    (path) => {
      expect(runsMiddleware(path)).toBe(false);
    },
  );
});
