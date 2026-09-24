import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { gatedResponse } from "@/lib/security/gated-response";

/**
 * Protege o app inteiro (sessão obrigatória) via `gatedResponse`, que também emite a
 * CSP com nonce (#467). Usa só o `authConfig` edge-safe (sem adapter/DB) — JWT é
 * validado a partir do cookie no edge. Rotas não-autenticadas redirecionam pra
 * `/signin` (pages.signIn).
 *
 * O matcher exclui:
 *  - `/api/*`  → endpoints do Auth.js + cron (este tem proteção própria via
 *                CRON_SECRET). Excluir é essencial pro callback do magic link.
 *  - `/monitoring` → rota de túnel do Sentry (`tunnelRoute` em next.config.ts).
 *                    A POST de telemetria do browser bate aqui; em páginas
 *                    públicas/pré-login não há sessão, então sem excluir o
 *                    evento toma 307→/signin e some silenciosamente.
 *  - assets estáticos (`_next/static`, `_next/image`, `favicon.ico`)
 *  - `/robots.txt` e `/sitemap.xml` → rotas de metadata do Next (SEO, #439): têm
 *    que ser lidas por crawlers SEM sessão. Sem excluir, tomavam 307→/signin e
 *    sumiam pros bots (report 06 achado #2). Ancoradas (`robots\.txt$`/`sitemap\.xml$`)
 *    como as irmãs, com o ponto escapado — liberam só o arquivo exato;
 *    `/robots.txtfoo` e `/robotsXtxt` seguem gateados.
 *  - `/signin` → a própria página de login
 *  - `/como-funciona` → página pública de ajuda (sem sessão, conteúdo estático)
 *  - `/termos` e `/privacidade` → páginas legais públicas (ops 05 §7): precisam ser
 *    lidas ANTES do login (linkadas no /signin e no footer global). Estáticas, sem
 *    sessão/DB. Ancoradas (`termos$`/`privacidade$`) como as irmãs.
 *  - `/p/[id]` (+ a sub-rota OG `/p/[id]/opengraph-image`) → página pública de palpite
 *    compartilhado (#384, ADR 0035): read-only, resolvível por qualquer um (privacidade é
 *    o opt-in `shared_at`, gateado na query). `p/[^/]+(?:/opengraph-image[^/]*)?$` libera
 *    UM segmento de id + a sub-rota OG; siblings/paths mais profundos seguem gateados.
 *  - `/` (raiz exata, âncora `$`) → landing pública estática (#373). A home
 *    autenticada mudou pra `/jogos`, que continua gateada (casa o matcher).
 */
const { auth } = NextAuth(authConfig);

// O handler refaz o redirect de não-autenticado (com handler, o Auth.js não redireciona
// sozinho) e adiciona a CSP com nonce das rotas gateadas (#467, ADR 0040). As rotas
// públicas acima não passam aqui: recebem a CSP estática do next.config.ts.
export const middleware = auth((req) => gatedResponse(req));

export const config = {
  // Âncoras (`api/`, `signin$`, `como-funciona$`, `monitoring(?:/|$)`) evitam
  // que rotas-irmãs hipotéticas (ex.: `/signin-foo`, `/como-funciona-foo`,
  // `/apidocs`, `/monitoringfoo`) escapem do gate por casarem o prefixo.
  // `monitoring(?:/|$)` é a rota de túnel do Sentry — manter em sincronia com
  // `tunnelRoute` em next.config.ts.
  // `$` no fim do grupo libera APENAS a raiz exata `/` (landing pública, #373):
  // o caminho após o `/` inicial é vazio só pra raiz, então `$` casa só ela —
  // `/jogos`, `/dashboard`, `/perfil`, `/match/123`, `/admin` seguem gateados.
  matcher: [
    "/((?!api/|monitoring(?:/|$)|_next/static|_next/image|favicon.ico|robots\\.txt$|sitemap\\.xml$|signin$|como-funciona$|termos$|privacidade$|p/[^/]+(?:/opengraph-image[^/]*)?$|$).*)",
  ],
};
