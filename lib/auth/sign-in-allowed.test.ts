import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock da query layer por e-mail: getUserAllowedByEmail vira um spy configurável.
// Não toca Postgres — só verifica a resolução allow-by-default + short-circuit do
// env-floor de `isSignInAllowed` (ADR 0023 §3/§6, #257).
vi.mock("@/lib/db/queries/users", () => ({
  getUserAllowedByEmail: vi.fn(),
}));

import {
  isSignInAllowed,
  isSignInAllowedForAccount,
} from "@/lib/auth/whitelist-db";
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

// Regressão da auditoria de segurança 2026-11-01: passkey registrada deslogada com o
// e-mail de outra pessoa criava a row e, depois, Google/magic link caíam nessa conta.
describe("isSignInAllowedForAccount — passkey nunca cria conta", () => {
  it("webauthn + e-mail SEM row → false (bloqueia o pre-account takeover)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue(null);
    await expect(
      isSignInAllowedForAccount("vitima@ex.com", "webauthn"),
    ).resolves.toBe(false);
  });

  it("webauthn + e-mail do env-floor SEM row → false (o floor não abre exceção)", async () => {
    process.env.ALLOWED_EMAILS = "dono@ex.com";
    dbSpy.mockResolvedValue(null);
    await expect(
      isSignInAllowedForAccount("dono@ex.com", "webauthn"),
    ).resolves.toBe(false);
  });

  it("webauthn + erro de DB → false (fail-closed)", async () => {
    process.env.ALLOWED_EMAILS = "dono@ex.com";
    dbSpy.mockRejectedValue(new Error("db down"));
    await expect(
      isSignInAllowedForAccount("dono@ex.com", "webauthn"),
    ).resolves.toBe(false);
  });

  it("webauthn + e-mail vazio → false", async () => {
    await expect(isSignInAllowedForAccount(null, "webauthn")).resolves.toBe(false);
  });

  it("webauthn + row existente allowed=true → true (passkey de conta existente)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue({ allowed: true });
    await expect(
      isSignInAllowedForAccount("ativo@ex.com", "webauthn"),
    ).resolves.toBe(true);
  });

  it("webauthn + row existente allowed=false → false (bloqueio segue valendo)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue({ allowed: false });
    await expect(
      isSignInAllowedForAccount("bloqueado@ex.com", "webauthn"),
    ).resolves.toBe(false);
  });

  it("outros providers mantêm o allow-by-default (e-mail novo → true)", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue(null);
    await expect(isSignInAllowedForAccount("novo@ex.com", "email")).resolves.toBe(true);
    await expect(isSignInAllowedForAccount("novo@ex.com", "oidc")).resolves.toBe(true);
  });
});
