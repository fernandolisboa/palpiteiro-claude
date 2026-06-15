import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock da query layer por e-mail: getUserAllowedByEmail vira um spy configurável.
// Não toca Postgres — só verifica a resolução allow-by-default + short-circuit do
// env-floor de `isSignInAllowed` (ADR 0023 §3/§6, #257).
vi.mock("@/lib/db/queries/users", () => ({
  getUserAllowedByEmail: vi.fn(),
}));

import { isSignInAllowed } from "@/lib/auth/whitelist-db";
import { getUserAllowedByEmail } from "@/lib/db/queries/users";

const dbSpy = vi.mocked(getUserAllowedByEmail);

let savedAllowedEmails: string | undefined;

beforeEach(() => {
  savedAllowedEmails = process.env.ALLOWED_EMAILS;
  dbSpy.mockReset();
});

afterEach(() => {
  if (savedAllowedEmails === undefined) {
    delete process.env.ALLOWED_EMAILS;
  } else {
    process.env.ALLOWED_EMAILS = savedAllowedEmails;
  }
});

describe("isSignInAllowed — self-provision aberto (allow-by-default)", () => {
  it("(a) e-mail no env-floor → true E não consulta o DB (short-circuit)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    await expect(isSignInAllowed("admin@ex.com")).resolves.toBe(true);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("(a) env-floor é case-insensitive: env 'test@ex.com' + 'Test@EX.COM' → true, sem DB", async () => {
    process.env.ALLOWED_EMAILS = "test@ex.com";
    await expect(isSignInAllowed("Test@EX.COM")).resolves.toBe(true);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("(c) e-mail NOVO (sem row no DB) → true (auto-provisionado)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue(null);
    await expect(isSignInAllowed("novo@ex.com")).resolves.toBe(true);
    expect(dbSpy).toHaveBeenCalledWith("novo@ex.com");
  });

  it("(b) row existente com allowed=true → true", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue({ allowed: true });
    await expect(isSignInAllowed("ativo@ex.com")).resolves.toBe(true);
  });

  it("(b) row existente com allowed=false → false (bloqueado)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue({ allowed: false });
    await expect(isSignInAllowed("bloqueado@ex.com")).resolves.toBe(false);
    expect(dbSpy).toHaveBeenCalledWith("bloqueado@ex.com");
  });

  it("bloqueio NÃO morde o env-floor: env-listado + allowed=false → true, sem DB", async () => {
    process.env.ALLOWED_EMAILS = "dono@ex.com";
    dbSpy.mockResolvedValue({ allowed: false });
    await expect(isSignInAllowed("dono@ex.com")).resolves.toBe(true);
    // §6: short-circuit no env ANTES de qualquer read — DB nem é tocado.
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("e-mail null/undefined/vazio → false, sem DB", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    await expect(isSignInAllowed(null)).resolves.toBe(false);
    await expect(isSignInAllowed(undefined)).resolves.toBe(false);
    await expect(isSignInAllowed("")).resolves.toBe(false);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("DB rejeita + e-mail no env → true (fallback env, short-circuit antes do read)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    dbSpy.mockRejectedValue(new Error("neon down"));
    await expect(isSignInAllowed("admin@ex.com")).resolves.toBe(true);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("DB rejeita + e-mail não-listado → false (conservador, não auto-provisiona às cegas)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    dbSpy.mockRejectedValue(new Error("neon down"));
    await expect(isSignInAllowed("estranho@ex.com")).resolves.toBe(false);
    expect(dbSpy).toHaveBeenCalledWith("estranho@ex.com");
  });
});
