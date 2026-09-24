import type { NextAuthRequest } from "next-auth";
import { NextResponse } from "next/server";

import { CSP_HEADER, cspForEnv, generateNonce } from "@/lib/security/csp";

const SIGN_IN_PATH = "/signin";

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
