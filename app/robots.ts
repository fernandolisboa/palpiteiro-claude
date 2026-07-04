import type { MetadataRoute } from "next";

// Domínio de produção — espelha o `metadataBase` de app/layout.tsx. Rotas de
// metadata do Next (robots/sitemap) NÃO herdam `metadataBase`, então a URL
// absoluta do sitemap precisa ser explícita aqui.
const SITE_URL = "https://palpiteiro.live";

/**
 * `/robots.txt` público (Next metadata route, #439). Libera as 4 páginas
 * indexáveis (landing `/`, `/como-funciona`, `/termos`, `/privacidade`) e bloqueia
 * tudo que é gateado por sessão (app autenticado + API) ou noindex por regulação:
 * o segmento `/p/` de palpite compartilhado (ADR 0035 §6 — indexação deferida pra
 * Fase-3).
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
        "/dashboard",
        "/match",
        "/perfil",
        "/admin",
        "/signin",
        "/api",
        "/p/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
