import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

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
    return [
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
        source: "/:path((?!_next/|api/|monitoring(?:/|$)|p/).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        // /p/[id] + /p/[id]/opengraph-image (#384, ADR 0035 §8/§11/§13): snapshot público
        // imutável (cache longo) + noindex + no-referrer. `:path*` cobre a página E a sub-rota
        // OG. A página (Server Component, sem Cache-Control próprio) pega este header limpo; a
        // rota OG self-seta `max-age=0,must-revalidate` (merge layer-dependent) → o cache longo
        // da imagem vem do `export const revalidate=86400` da rota, não garantido por headers()
        // (verificar com `curl -I` no `next start`). X-Robots-Tag/Referrer-Policy são aditivos
        // (sem colisão) e alcançam página + OG.
        source: "/p/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, immutable" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Referrer-Policy", value: "no-referrer" },
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
