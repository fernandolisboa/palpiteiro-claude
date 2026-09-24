import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

import { CSP_HEADER, cspForEnv, PUBLIC_HTML_SOURCES } from "./lib/security/csp";

const nextConfig: NextConfig = {
  // Build id determinístico a partir do commit SHA do deploy (ADR 0024). `null`
  // = comportamento default do Next (id aleatório) em dev/local, onde a env não
  // existe. Em prod/preview a Vercel injeta VERCEL_GIT_COMMIT_SHA.
  generateBuildId: async () => process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  // Mapeia o SHA (server-only) pra uma env pública, inlinada no bundle cliente
  // em build-time. O version-checker lê `process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
  // como ÂNCORA da versão carregada e compara com /api/version (live). Fallback
  // "dev" em local → o detector vira no-op (ADR 0024).
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  async headers() {
    const publicCsp = cspForEnv();
    return [
      // Content-Security-Policy (#467, ADR 0040) — fase report-only; ver lib/security/csp.ts.
      ...PUBLIC_HTML_SOURCES.map((source) => ({
        source,
        headers: [{ key: CSP_HEADER, value: publicCsp }],
      })),
      {
        // Documento HTML → no-cache pra o Safari (iOS) não segurar HTML antigo
        // por dias após deploy (ADR 0024). CRÍTICO: o lookahead negativo exclui
        // `_next/` (assets content-hashed servidos `immutable` pela Vercel),
        // `/api/` (a /api/version manda seu próprio no-store) e o túnel do Sentry
        // `/monitoring` — sobrescrever esses clobbaria o cache imutável/o no-store.
        //
        // Sintaxe: em headers() o lookahead negativo PRECISA estar pendurado num
        // param nomeado (`/:path(...)`), diferente do matcher do middleware
        // (`/((?!...).*)`). `monitoring(?:/|$)` ancora só a rota exata do túnel
        // (não rotas-irmãs), em sincronia com middleware.ts. Validado via o parser
        // do próprio Next (try-to-parse-path).
        //
        // Hoje não há estáticos fora de `_next/` (sem `public/`, sem favicon de
        // metadata). Se um ícone estático for adicionado (ex.: `app/favicon.ico`,
        // `app/icon.png`), estenda o lookahead (ex.: `|favicon\.ico|icon|apple-icon`)
        // pra ele não cair em `no-cache` em vez de cache longo (ADR 0024).
        //
        // `robots\.txt`/`sitemap\.xml` (#468, fecha #439): metadata routes ESTÁTICAS
        // (`○` prerendered) que mudam só no deploy — não são documento HTML e não
        // devem tomar `no-cache`. Excluídas aqui (como `_next/`) e cacheadas no bloco
        // dedicado abaixo. Sem essa exclusão, o crawler re-baixaria as duas a cada hit.
        source:
          "/:path((?!_next/|api/|monitoring(?:/|$)|p/|robots\\.txt|sitemap\\.xml).*)",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        // /robots.txt + /sitemap.xml (#468, ADR 0024): conteúdo estático que só muda
        // no deploy (a Vercel invalida o cache de CDN a cada deploy novo). `max-age=0,
        // must-revalidate` no BROWSER (revalida barato via 304) + `s-maxage=86400` na
        // CDN (serve cacheado por 24h entre deploys). Header ÚNICO de Cache-Control:
        // o bloco no-cache acima agora as exclui, então não há colisão. Verificar em
        // prod: `curl -I https://palpiteiro.live/robots.txt` (e /sitemap.xml).
        source: "/:path(robots\\.txt|sitemap\\.xml)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=86400, must-revalidate",
          },
        ],
      },
      {
        // /p/[id] + /p/[id]/opengraph-image (#384/#416/#438, ADR 0035 §3e/§8/§11/§13): snapshot
        // público + noindex + no-referrer. `:path*` cobre a página E a sub-rota OG.
        // Cache-Control `public, max-age=0, must-revalidate` (#438): o BROWSER revalida a cada
        // view; o escudo de custo contra link viral é o ISR (`revalidate = 86400` da página),
        // que a Vercel cacheia independente deste header e que `revalidatePath` purga. Antes era
        // `max-age=86400, immutable`, que pinava a página no browser por 24h — o kill-switch
        // (unshareSet limpa shared_at + revalidatePath) não alcançava quem já tinha aberto o link.
        // SEM `s-maxage` de propósito: com ele a CDN poderia guardar um 404/redirect por 24h
        // fora do controle do revalidatePath.
        //   - ROTA OG → DOIS headers Cache-Control: este MAIS o que o ImageResponse self-seta
        //     (`public, immutable, no-transform, max-age=31536000`). A imagem segue agressivamente
        //     cacheada pelo próprio ImageResponse; o duplo-header é cosmético. Unfurls já raspados
        //     (WhatsApp/X) vivem no cache do scraper e não são revogáveis por nós de qualquer jeito.
        // X-Robots-Tag/Referrer-Policy são aditivos (sem colisão) e alcançam página + OG.
        // NOTA dead-link (#416, VERIFICADO em prod): o caminho notFound retorna `private,
        // no-cache, no-store, max-age=0, must-revalidate` + `x-vercel-cache: MISS` — o Next força
        // no-store no notFound → o 404 NÃO é cacheado.
        source: "/p/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Headers de segurança globais (report 01 achado #2 / #436). Aplicam a TODAS as
        // rotas (inclui /p, que só ADICIONA os seus). A CSP mora no topo desta lista (páginas
        // públicas) e no middleware (gateadas, com nonce) — #467. Permissions-Policy nomeia só
        // camera/microphone/geolocation (nega): WebAuthn/passkey usa
        // `publickey-credentials-get`, que NÃO é listado → mantém o default (self), intacto.
        // X-Frame-Options DENY: o app não é embutido em iframe (o Sentry usa fetch, não frame).
        // HSTS sem `preload` de propósito (reversível; adicionar preload é compromisso do dono).
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Referrer-Policy padrão em TUDO EXCETO /p — a rota /p já seta `no-referrer` (mais
        // estrito, ADR 0035) no bloco dela; excluir /p aqui evita dois Referrer-Policy no
        // mesmo response. O lookahead `(?!p/)` casa a raiz e as demais rotas, barra `p/...`.
        source: "/:path((?!p/).*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Lidos do env (Vercel build + .env.local) — sem hard-code. Ausentes, o
  // plugin só pula o upload de source maps (build não falha).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Route browser events through Next.js to avoid adblocker interference
  tunnelRoute: "/monitoring",

  // Instrument Vercel Cron jobs automatically
  automaticVercelMonitors: true,
});
