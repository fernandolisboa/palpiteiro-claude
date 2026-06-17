import { describe, expect, it } from "vitest";

import {
  assistCartridge,
  SYSTEM_PROMPT,
} from "@/lib/ai/markets/assist";

describe("assist cartridge", () => {
  it("hardcoda o piso de edge de 8 pontos percentuais (sincronia UI↔prompt)", () => {
    expect(SYSTEM_PROMPT).toContain("8 pontos percentuais");
    expect(SYSTEM_PROMPT).toContain("edge >= 8%");
  });

  it("descriptor e marketKey de assistência", () => {
    expect(assistCartridge.marketKey).toBe("assist");
    expect(assistCartridge.descriptor.dbMarketKey).toBe("assist");
    expect(assistCartridge.descriptor.marketKind).toBe("independent_binary");
  });

  it("prompt fala de assistência (não de gol)", () => {
    expect(SYSTEM_PROMPT).toContain("assistência");
  });
});
