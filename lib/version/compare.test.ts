import { describe, expect, it } from "vitest";

import { isNewVersionAvailable } from "./compare";

describe("isNewVersionAvailable", () => {
  it("retorna false quando os SHAs são iguais", () => {
    expect(isNewVersionAvailable("abc123", "abc123")).toBe(false);
  });

  it("retorna true quando os SHAs reais diferem", () => {
    expect(isNewVersionAvailable("abc123", "def456")).toBe(true);
  });

  it("é simétrico: qualquer divergência dispara (inclui rollback)", () => {
    // loaded vs current pode divergir em qualquer direção (deploy novo OU
    // rollback do servidor pra um SHA "anterior"); ambos pedem reload.
    expect(isNewVersionAvailable("abc123", "def456")).toBe(true);
    expect(isNewVersionAvailable("def456", "abc123")).toBe(true);
  });

  it("retorna false quando algum lado é null", () => {
    expect(isNewVersionAvailable(null, "abc123")).toBe(false);
    expect(isNewVersionAvailable("abc123", null)).toBe(false);
    expect(isNewVersionAvailable(null, null)).toBe(false);
  });

  it("retorna false quando algum lado é undefined", () => {
    expect(isNewVersionAvailable(undefined, "abc123")).toBe(false);
    expect(isNewVersionAvailable("abc123", undefined)).toBe(false);
    expect(isNewVersionAvailable(undefined, undefined)).toBe(false);
  });

  it("retorna false quando algum lado é string vazia", () => {
    expect(isNewVersionAvailable("", "abc123")).toBe(false);
    expect(isNewVersionAvailable("abc123", "")).toBe(false);
  });

  it('retorna false quando algum lado é o sentinela "dev"', () => {
    expect(isNewVersionAvailable("dev", "abc123")).toBe(false);
    expect(isNewVersionAvailable("abc123", "dev")).toBe(false);
    expect(isNewVersionAvailable("dev", "dev")).toBe(false);
  });
});
