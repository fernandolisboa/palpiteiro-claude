import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isEmailAllowed } from "@/lib/auth/whitelist";

/**
 * Guarda a lógica env-only de `whitelist.ts`, que deve seguir verde mesmo depois
 * do `signIn` sair do `auth.config.ts` (ADR 0009). Sem mock de DB — puro env.
 */

let savedAllowedEmails: string | undefined;

beforeEach(() => {
  savedAllowedEmails = process.env.ALLOWED_EMAILS;
});

afterEach(() => {
  if (savedAllowedEmails === undefined) {
    delete process.env.ALLOWED_EMAILS;
  } else {
    process.env.ALLOWED_EMAILS = savedAllowedEmails;
  }
});

describe("isEmailAllowed — whitelist env-only", () => {
  it("e-mail presente em ALLOWED_EMAILS → true", () => {
    process.env.ALLOWED_EMAILS = "voce@ex.com";
    expect(isEmailAllowed("voce@ex.com")).toBe(true);
  });

  it("ALLOWED_EMAILS vazio → false pra qualquer e-mail", () => {
    process.env.ALLOWED_EMAILS = "";
    expect(isEmailAllowed("voce@ex.com")).toBe(false);
  });

  it("ALLOWED_EMAILS ausente → false pra qualquer e-mail", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isEmailAllowed("voce@ex.com")).toBe(false);
  });

  it("e-mail null/undefined → false", () => {
    process.env.ALLOWED_EMAILS = "voce@ex.com";
    expect(isEmailAllowed(null)).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
  });

  it("normaliza caixa + espaço nas duas pontas", () => {
    process.env.ALLOWED_EMAILS = "voce@ex.com";
    expect(isEmailAllowed("  Voce@EX.com ")).toBe(true);
  });

  it("lista com vírgula e espaços extras é parseada corretamente", () => {
    process.env.ALLOWED_EMAILS = " a@x.com ,  b@y.com , c@z.com ";
    expect(isEmailAllowed("a@x.com")).toBe(true);
    expect(isEmailAllowed("b@y.com")).toBe(true);
    expect(isEmailAllowed("c@z.com")).toBe(true);
    expect(isEmailAllowed("d@w.com")).toBe(false);
  });
});
