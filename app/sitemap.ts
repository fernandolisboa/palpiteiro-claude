import type { MetadataRoute } from "next";

// Domínio de produção — espelha o `metadataBase` de app/layout.tsx (ver robots.ts).
const SITE_URL = "https://palpiteiro.live";

/**
 * `/sitemap.xml` público (Next metadata route, #439). Só as 4 páginas indexáveis
 * — as mesmas liberadas no robots.ts. O app autenticado e o `/p/` ficam de fora
 * (gateados/noindex). `lastModified` = momento do build (páginas estáticas).
 *
 * LANDMINE: idem robots.ts — só alcançável porque o matcher do middleware exclui
 * `sitemap.xml$`. Ver middleware.ts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified },
    { url: `${SITE_URL}/como-funciona`, lastModified },
    { url: `${SITE_URL}/termos`, lastModified },
    { url: `${SITE_URL}/privacidade`, lastModified },
  ];
}
