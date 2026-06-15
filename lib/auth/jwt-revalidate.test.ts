import { describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

import { revalidateToken } from "@/lib/auth/jwt-revalidate";

// Helper puro (#252, ADR 0023): revalida role+allowed do token contra o DB. A
// query é injetada (`getState`) pra testar sem env de DB nem o adapter do auth.ts.

describe("revalidateToken", () => {
  it("copia role+allowed FRESCOS do DB pro token (mudança de role vale sem novo login)", async () => {
    const token: JWT = { id: "u1", role: "user", allowed: false };
    const getState = vi.fn().mockResolvedValue({ role: "admin", allowed: true });
    const out = await revalidateToken(token, getState);
    expect(getState).toHaveBeenCalledWith("u1");
    expect(out).not.toBeNull();
    expect(out!.role).toBe("admin");
    expect(out!.allowed).toBe(true);
  });

  it("propaga allowed=false pro token SEM derrubar a sessão (anti-lockout do floor de env)", async () => {
    const token: JWT = { id: "u1", role: "user", allowed: true };
    const getState = vi.fn().mockResolvedValue({ role: "user", allowed: false });
    const out = await revalidateToken(token, getState);
    // Não retorna null: derrubar por allowed=false criaria loop de login pra
    // contas do floor (ALLOWED_EMAILS). O bloqueio de custo é o read em analyzeMatch.
    expect(out).not.toBeNull();
    expect(out!.allowed).toBe(false);
  });

  it("retorna null (drop de sessão) quando a row sumiu", async () => {
    const token: JWT = { id: "u1", role: "user", allowed: true };
    const getState = vi.fn().mockResolvedValue(null);
    const out = await revalidateToken(token, getState);
    expect(out).toBeNull();
  });

  it("passa o token adiante inalterado e NÃO lê o DB quando não há token.id", async () => {
    const token: JWT = {};
    const getState = vi.fn();
    const out = await revalidateToken(token, getState);
    expect(getState).not.toHaveBeenCalled();
    expect(out).toBe(token);
  });
});
