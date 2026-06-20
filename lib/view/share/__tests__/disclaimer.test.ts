import { describe, expect, it } from "vitest";

import {
  CVV_HELP,
  NON_OPERATOR_DISCLAIMER,
  OG_DISCLAIMER_STRIP,
  PALPITE_DISCLAIMER,
  RISK_DISCLAIMER,
} from "@/lib/view/share/disclaimer";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

describe("disclaimers do /p (ADR §10) — single-sourced + firewall-safe", () => {
  it("os 3 blocos + CVV são firewall-limpos (sem linguagem de valor)", () => {
    for (const block of [
      PALPITE_DISCLAIMER,
      RISK_DISCLAIMER,
      NON_OPERATOR_DISCLAIMER,
    ]) {
      expect(containsValueLanguage(block)).toBe(false);
    }
    expect(CVV_HELP.label).toContain("188");
    expect(CVV_HELP.href).toMatch(/^https:\/\//);
  });

  it("OG_DISCLAIMER_STRIP é DERIVADO de PALPITE_DISCLAIMER (não literal solto)", () => {
    const derived = `18+ · ${PALPITE_DISCLAIMER.replace(
      /^É só um palpite, /,
      "",
    ).replace(/\.$/, "")}`;
    expect(OG_DISCLAIMER_STRIP).toBe(derived);
  });

  it("a tira do OG NÃO é nenhum dos blocos completos (é comprimida)", () => {
    expect(OG_DISCLAIMER_STRIP).not.toBe(PALPITE_DISCLAIMER);
    expect(OG_DISCLAIMER_STRIP).not.toBe(RISK_DISCLAIMER);
    expect(OG_DISCLAIMER_STRIP).not.toBe(NON_OPERATOR_DISCLAIMER);
  });

  it("a tira carrega o selo 18+ e é firewall-limpa", () => {
    expect(OG_DISCLAIMER_STRIP).toContain("18+");
    expect(containsValueLanguage(OG_DISCLAIMER_STRIP)).toBe(false);
  });

  it("RISK_DISCLAIMER é o §3 verbatim do legal doc", () => {
    expect(RISK_DISCLAIMER).toContain("Aposta não é investimento");
    expect(RISK_DISCLAIMER).toContain("não garantem resultado");
  });
});
