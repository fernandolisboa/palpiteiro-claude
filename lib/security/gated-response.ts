import type { NextAuthRequest } from "next-auth";
import { NextResponse } from "next/server";

import { CSP_HEADER, cspForEnv, generateNonce } from "@/lib/security/csp";

const SIGN_IN_PATH = "/signin";
const APP_HOME_PATH = "/jogos";

/**
 * Resposta do middleware pras rotas gateadas: gate de sessão + CSP com nonce (#467).
 *
 * Ao passar um handler pro `auth()` do Auth.js v5, o redirect default de "não
 * autorizado" deixa de rodar — o callback `authorized` só manda quando retorna uma
 * Response (`next-auth/lib/index.js` handleAuth). Por isso o gate é refeito aqui,
 * espelhando o comportamento do Auth.js: 307 → `/signin?callbackUrl=<href>`.
 *
 * Autenticado: nonce novo por request, posto no header de CSP da REQUEST (o Next lê
 * de lá pra carimbar os scripts inline do framework) e no da RESPONSE (o browser).
 */
export function gatedResponse(req: NextAuthRequest): NextResponse {
  if (!req.auth?.user) {
    const signInUrl = req.nextUrl.clone();
    signInUrl.pathname = SIGN_IN_PATH;
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }

  const csp = cspForEnv(generateNonce());
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CSP_HEADER, csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(CSP_HEADER, csp);
  return res;
}

/**
 * A entrada `"/"` do matcher também casa as formas de transporte da raiz (`/index`,
 * `/index.rsc`, que o adapter do Next normaliza pra `/index`) — tratá-las como raiz
 * evita que caiam no `gatedResponse` e recebam a landing com CSP de nonce.
 */
export function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/index";
}

/**
 * Resposta do middleware pra raiz `/` (landing pública, #373). A landing é estática e
 * não lê sessão, então quem está logado e cai em `/` (link de volta, logo, URL digitada)
 * caía na tela de "Entrar" como se estivesse deslogado. Aqui: logado → 307 pra `/jogos`;
 * deslogado → segue pra landing SEM CSP de nonce (ela recebe a CSP estática do
 * next.config.ts — mandar as duas quebraria o invariante de `csp-coverage.test.ts`).
 */
export function landingResponse(req: NextAuthRequest): NextResponse {
  if (req.auth?.user) {
    const homeUrl = req.nextUrl.clone();
    homeUrl.pathname = APP_HOME_PATH;
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }
  return NextResponse.next();
}
