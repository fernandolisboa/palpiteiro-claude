import { describe, expect, it } from "vitest";

import { DEFAULT_TIME_ZONE, resolveTimeZone } from "@/lib/view/timezone";

describe("resolveTimeZone", () => {
  it("undefined/null/'' → default (BRT)", () => {
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIME_ZONE);
  });

  it("IANA válido → passa direto", () => {
    expect(resolveTimeZone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveTimeZone("UTC")).toBe("UTC");
  });

  it("valor inválido/forjado → default (não lança)", () => {
    expect(resolveTimeZone("Not/A_Zone")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("'; DROP TABLE;")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("America/Sao_Paulo; evil")).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("resolveTimeZone — só nome IANA (#643)", () => {
  it("rejeita offset cru, que o Postgres leria com o sinal trocado", () => {
    expect(resolveTimeZone("+03:00")).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("-0300")).toBe(DEFAULT_TIME_ZONE);
  });

  it("aceita UTC e nomes com +/- (Etc/GMT+3)", () => {
    expect(resolveTimeZone("UTC")).toBe("UTC");
    expect(resolveTimeZone("Etc/GMT+3")).toBe("Etc/GMT+3");
    expect(resolveTimeZone("America/Argentina/Buenos_Aires")).toBe(
      "America/Argentina/Buenos_Aires",
    );
  });
});
