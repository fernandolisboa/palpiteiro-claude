import type { NextAuthRequest } from "next-auth";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { CSP_HEADER } from "@/lib/security/csp";
import { gatedResponse } from "@/lib/security/gated-response";

function req(url: string, authed: boolean): NextAuthRequest {
  const r = new NextRequest(url) as NextAuthRequest;
  r.auth = authed
    ? { user: { id: "u1", role: "user" }, expires: "2099-01-01T00:00:00.000Z" }
    : null;
  return r;
}

describe("gatedResponse", () => {
  it("sem sessão → 307 pro /signin com callbackUrl (mesmo comportamento do Auth.js)", () => {
    const res = gatedResponse(req("https://palpiteiro.live/jogos?x=1", false));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/signin");
    expect(loc.searchParams.get("callbackUrl")).toBe(
      "https://palpiteiro.live/jogos?x=1"
    );
    expect(res.headers.get(CSP_HEADER)).toBeNull();
  });

  it("com sessão → segue, com CSP de nonce na response E repassada na request", () => {
    const res = gatedResponse(req("https://palpiteiro.live/jogos", true));
    expect(res.status).toBe(200);
    const csp = res.headers.get(CSP_HEADER) ?? "";
    expect(csp).toMatch(
      /'nonce-[A-Za-z0-9+/=]+' 'sha256-[^']+' 'strict-dynamic'/
    );
    // NextResponse.next({ request: { headers } }) serializa os headers sobrescritos
    // em x-middleware-request-*; é daí que o Next lê o nonce pros scripts inline.
    expect(
      res.headers.get(`x-middleware-request-${CSP_HEADER.toLowerCase()}`)
    ).toBe(csp);
  });

  it("nonce novo a cada request", () => {
    const a = gatedResponse(req("https://palpiteiro.live/jogos", true));
    const b = gatedResponse(req("https://palpiteiro.live/jogos", true));
    expect(a.headers.get(CSP_HEADER)).not.toBe(b.headers.get(CSP_HEADER));
  });
});
