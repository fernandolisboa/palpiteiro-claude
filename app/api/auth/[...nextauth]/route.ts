import type { NextRequest } from "next/server";

import { handlers } from "@/auth";
import {
  isMagicLinkSendAllowed,
  normalizeMagicLinkEmail,
} from "@/lib/auth/magic-link-guard";

export const { GET } = handlers;

// Envio de magic link pelo endpoint cru do Auth.js. `/api/` fica fora do middleware,
// então sem este guard um script pegava o token de /api/auth/csrf e postava aqui em
// loop, pulando os tetos da action `sendMagicLink` (auditoria de segurança 2026-11-01).
const MAGIC_LINK_SEND_PATH = /\/signin\/resend\/?$/;

async function emailFromBody(req: NextRequest): Promise<string> {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body: unknown = await req.clone().json();
      return normalizeMagicLinkEmail(
        body && typeof body === "object" && "email" in body ? body.email : "",
      );
    }
    return normalizeMagicLinkEmail((await req.clone().formData()).get("email"));
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  if (MAGIC_LINK_SEND_PATH.test(req.nextUrl.pathname)) {
    const email = await emailFromBody(req);
    if (!(await isMagicLinkSendAllowed(email, req.headers))) {
      return Response.redirect(
        new URL("/signin?error=RateLimited", req.nextUrl.origin),
        303,
      );
    }
  }
  return handlers.POST(req);
}
