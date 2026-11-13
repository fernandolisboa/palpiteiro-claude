import type { MetadataRoute } from "next";

// Domínio de produção — espelha o `metadataBase` de app/layout.tsx. Rotas de
// metadata do Next (robots/sitemap) NÃO herdam `metadataBase`, então a URL
// absoluta do sitemap precisa ser explícita aqui.
const SITE_URL = "https://palpiteiro.live";

/**
 * `/robots.txt` público (Next metadata route, #439). Libera as 4 páginas
 * indexáveis (landing `/`, `/como-funciona`, `/termos`, `/privacidade`) e bloqueia
 * o que é gateado por sessão (app autenticado + API).
 *
 * `/p/` fica deliberadamente FORA do disallow: o ADR 0035 §6 tira o share do
 * índice via noindex (meta + `X-Robots-Tag`) COM o unfurl/OG preservado. Um
 * `Disallow: /p/` quebraria os dois lados — o crawler bloqueado nunca VÊ o
 * noindex (a URL ainda pode aparecer no índice "reference-only") e bots de
 * unfurl que respeitam robots.txt (Twitterbot) deixariam de montar o card.
 *
 * Todo segmento de topo de `app/(app)/` (área logada, 307 → /signin) TEM que estar
 * no disallow: senão o Google rastreia o redirect e reporta "Page with redirect"
 * (#666). O teste `__tests__/robots.test.ts` lê o diretório e acusa rota esquecida.
 *
 * `/signin` fica FORA do disallow de propósito (#666): a página tem `noindex`, e o
 * crawler só obedece o noindex se puder ler a página. Bloqueada no robots, a URL
 * ainda podia entrar no índice como "indexada, mas bloqueada".
 *
 * LANDMINE (report 06 achado #2): esta rota só é alcançável por crawlers porque o
 * matcher do middleware exclui `robots.txt$` — sem essa emenda pareada,
 * `/robots.txt` tomava 307→/signin e sumia pros bots. Ver middleware.ts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/como-funciona", "/termos", "/privacidade"],
      disallow: [
        "/jogos",
        "/apostas",
        "/bolao",
        "/dashboard",
        "/match",
        "/perfil",
        "/admin",
        "/como-usar",
        "/api",
        "/time",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
