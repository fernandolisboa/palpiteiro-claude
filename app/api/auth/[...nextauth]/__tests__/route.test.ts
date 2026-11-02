import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regressão da auditoria de segurança 2026-11-01: o POST cru do Auth.js em
// /api/auth/signin/resend pulava os tetos de envio do magic link.
vi.mock("@/auth", () => ({
  handlers: {
    GET: vi.fn(),
    POST: vi.fn(async () => new Response("auth.js", { status: 200 })),
  },
}));
vi.mock("@/lib/auth/magic-link-rate-limit", () => ({
  checkMagicLinkRateLimit: vi.fn(),
  checkMagicLinkIpRateLimit: vi.fn(),
  checkMagicLinkGlobalRateLimit: vi.fn(),
}));

import { POST } from "@/app/api/auth/[...nextauth]/route";
import { handlers } from "@/auth";
import {
  checkMagicLinkGlobalRateLimit,
  checkMagicLinkIpRateLimit,
  checkMagicLinkRateLimit,
} from "@/lib/auth/magic-link-rate-limit";

const emailLimit = vi.mocked(checkMagicLinkRateLimit);
const ipLimit = vi.mocked(checkMagicLinkIpRateLimit);
const globalLimit = vi.mocked(checkMagicLinkGlobalRateLimit);
const authPost = vi.mocked(handlers.POST);

function formPost(path: string, email = "Vitima@Ex.com ") {
  return new NextRequest(`https://palpiteiro.live${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "203.0.113.7",
    },
    body: new URLSearchParams({ email, csrfToken: "t" }).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  emailLimit.mockResolvedValue(true);
  ipLimit.mockResolvedValue(true);
  globalLimit.mockResolvedValue(true);
});

describe("POST /api/auth/[...nextauth] — tetos do magic link", () => {
  it("dentro dos tetos → repassa pro Auth.js e conta IP + e-mail normalizado + global", async () => {
    const res = await POST(formPost("/api/auth/signin/resend"));
    expect(res.status).toBe(200);
    expect(authPost).toHaveBeenCalledOnce();
    expect(ipLimit).toHaveBeenCalledWith("203.0.113.7");
    expect(emailLimit).toHaveBeenCalledWith("vitima@ex.com");
    expect(globalLimit).toHaveBeenCalledOnce();
  });

  it.each([
    ["por IP", () => ipLimit.mockResolvedValue(false)],
    ["por e-mail", () => emailLimit.mockResolvedValue(false)],
    ["global", () => globalLimit.mockResolvedValue(false)],
  ])("teto %s estourado → 303 pra /signin?error=RateLimited, sem chamar o Auth.js", async (_, trip) => {
    trip();
    const res = await POST(formPost("/api/auth/signin/resend"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://palpiteiro.live/signin?error=RateLimited",
    );
    expect(authPost).not.toHaveBeenCalled();
  });

  it("e-mail em JSON também passa pelos tetos", async () => {
    emailLimit.mockResolvedValue(false);
    const req = new NextRequest("https://palpiteiro.live/api/auth/signin/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@ex.com" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(emailLimit).toHaveBeenCalledWith("a@ex.com");
    expect(authPost).not.toHaveBeenCalled();
  });

  it("outras rotas POST do Auth.js (ex.: signout, callback) não tocam os tetos", async () => {
    await POST(formPost("/api/auth/signout"));
    await POST(formPost("/api/auth/callback/passkey"));
    expect(authPost).toHaveBeenCalledTimes(2);
    expect(emailLimit).not.toHaveBeenCalled();
    expect(globalLimit).not.toHaveBeenCalled();
  });
});
