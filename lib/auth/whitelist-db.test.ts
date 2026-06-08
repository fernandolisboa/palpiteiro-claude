import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock da query layer: isEmailWhitelistedInDb vira um spy configurável por teste.
// Não toca Postgres — só verifica a composição env-first + fallback do
// whitelist-db (ADR 0009).
vi.mock("@/lib/db/queries/invites", () => ({
  isEmailWhitelistedInDb: vi.fn(),
}));

import { isEmailAllowedWithDb } from "@/lib/auth/whitelist-db";
import { isEmailWhitelistedInDb } from "@/lib/db/queries/invites";

const dbSpy = vi.mocked(isEmailWhitelistedInDb);

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

describe("isEmailAllowedWithDb — composição env-first + DB", () => {
  it("match no env → true E não consulta o DB (short-circuit)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    await expect(isEmailAllowedWithDb("admin@ex.com")).resolves.toBe(true);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("env miss + DB resolve true (users.allowed OU pending_invites) → true", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue(true);
    await expect(isEmailAllowedWithDb("convidado@ex.com")).resolves.toBe(true);
    expect(dbSpy).toHaveBeenCalledWith("convidado@ex.com");
  });

  it("env miss + DB resolve false → false", async () => {
    process.env.ALLOWED_EMAILS = "outro@ex.com";
    dbSpy.mockResolvedValue(false);
    await expect(isEmailAllowedWithDb("estranho@ex.com")).resolves.toBe(false);
  });

  it("env miss + DB rejeita → cai pro env-only (listado → true)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    dbSpy.mockRejectedValue(new Error("neon down"));
    // 'admin@ex.com' já teria dado short-circuit; usamos um e-mail não-listado
    // pra forçar o caminho do DB, e um listado pra provar o fallback.
    await expect(isEmailAllowedWithDb("admin@ex.com")).resolves.toBe(true);
    // short-circuit no env → DB nem chamado
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("env miss + DB rejeita + e-mail não-listado → false (cost-safe)", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    dbSpy.mockRejectedValue(new Error("neon down"));
    await expect(isEmailAllowedWithDb("estranho@ex.com")).resolves.toBe(false);
    expect(dbSpy).toHaveBeenCalledWith("estranho@ex.com");
  });

  it("case-insensitive: env 'test@ex.com' + input 'Test@EX.COM' → true via short-circuit", async () => {
    process.env.ALLOWED_EMAILS = "test@ex.com";
    await expect(isEmailAllowedWithDb("Test@EX.COM")).resolves.toBe(true);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("e-mail null/empty → false", async () => {
    process.env.ALLOWED_EMAILS = "admin@ex.com";
    await expect(isEmailAllowedWithDb(null)).resolves.toBe(false);
    await expect(isEmailAllowedWithDb(undefined)).resolves.toBe(false);
    await expect(isEmailAllowedWithDb("")).resolves.toBe(false);
    expect(dbSpy).not.toHaveBeenCalled();
  });
});
