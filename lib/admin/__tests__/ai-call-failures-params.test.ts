import { describe, expect, it } from "vitest";

import {
  AI_CALL_STATUS_LABEL,
  errorPreview,
  ERROR_PREVIEW_CHARS,
  failuresHref,
  parseAiCallFailuresParams,
} from "@/lib/admin/ai-call-failures-params";

const UUID = "3f6c1a2e-8b4d-4c1e-9a7f-2d5e6b7c8a90";

describe("parseAiCallFailuresParams (#669)", () => {
  it("dias só 1, 7 ou 30; o resto vira 7", () => {
    expect(parseAiCallFailuresParams({ dias: "1" }).days).toBe(1);
    expect(parseAiCallFailuresParams({ dias: "30" }).days).toBe(30);
    expect(parseAiCallFailuresParams({}).days).toBe(7);
    expect(parseAiCallFailuresParams({ dias: "365" }).days).toBe(7);
    expect(parseAiCallFailuresParams({ dias: "abc" }).days).toBe(7);
    expect(parseAiCallFailuresParams({ dias: ["30", "1"] }).days).toBe(30);
  });

  it("jogo só uuid válido (texto qualquer derrubaria a query no Postgres)", () => {
    expect(parseAiCallFailuresParams({ jogo: UUID }).matchId).toBe(UUID);
    expect(parseAiCallFailuresParams({ jogo: "m-1" }).matchId).toBeNull();
    expect(
      parseAiCallFailuresParams({ jogo: "' or 1=1 --" }).matchId
    ).toBeNull();
    expect(parseAiCallFailuresParams({ jogo: "" }).matchId).toBeNull();
    expect(parseAiCallFailuresParams({}).matchId).toBeNull();
  });
});

describe("failuresHref", () => {
  it("defaults fora da URL", () => {
    expect(failuresHref({ days: 7, matchId: null })).toBe("/admin/ia/falhas");
    expect(failuresHref({ days: 30, matchId: null })).toBe(
      "/admin/ia/falhas?dias=30"
    );
    expect(failuresHref({ days: 7, matchId: UUID })).toBe(
      `/admin/ia/falhas?jogo=${UUID}`
    );
    expect(failuresHref({ days: 1, matchId: UUID })).toBe(
      `/admin/ia/falhas?dias=1&jogo=${UUID}`
    );
  });

  it("ida e volta", () => {
    const params = { days: 30, matchId: UUID } as const;
    const qs = new URL(failuresHref(params), "https://x").searchParams;
    expect(
      parseAiCallFailuresParams({
        dias: qs.get("dias") ?? undefined,
        jogo: qs.get("jogo") ?? undefined,
      })
    ).toEqual(params);
  });
});

describe("rótulos e prévia do erro", () => {
  it("todo status tem rótulo em português", () => {
    expect(AI_CALL_STATUS_LABEL.invalid_output).toBe("saída reprovada");
    expect(Object.values(AI_CALL_STATUS_LABEL).every((l) => l.length > 0)).toBe(
      true
    );
  });

  it("prévia corta em ~140 caracteres numa linha; texto curto fica igual", () => {
    expect(errorPreview("fidelity: x")).toBe("fidelity: x");
    const long = errorPreview(`${"a".repeat(100)}\n\n${"b".repeat(100)}`);
    expect(long.length).toBe(ERROR_PREVIEW_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toContain("\n");
  });
});
