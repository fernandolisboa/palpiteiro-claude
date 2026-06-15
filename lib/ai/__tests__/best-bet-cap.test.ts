import { describe, expect, it } from "vitest";

import {
  MAX_FANOUT_MARKETS,
  MAX_ADDITIONAL_FETCHES,
  capCandidates,
} from "@/lib/ai/best-bet";

describe("cost ceilings (#178) — pinned constants", () => {
  it("MAX_FANOUT_MARKETS = 6 (LLM-call ceiling com folga sobre os 4 do WC)", () => {
    expect(MAX_FANOUT_MARKETS).toBe(6);
  });
  it("MAX_ADDITIONAL_FETCHES = 4 (teto de créditos de odds additional/run)", () => {
    expect(MAX_ADDITIONAL_FETCHES).toBe(4);
  });
});

describe("capCandidates — retém SEMPRE os Tier-1 (over_under/match_result)", () => {
  // WC candidate set na ordem de marketsForAudience (over_under, depois alfabético).
  const wc = [
    { key: "over_under" },
    { key: "btts" },
    { key: "double_chance" },
    { key: "match_result" },
  ];

  it("length <= max → retorna como-está (ordem preservada, sem reordenar)", () => {
    expect(capCandidates(wc, MAX_FANOUT_MARKETS)).toEqual(wc);
  });

  it("length > max → NUNCA dropa over_under nem match_result, mesmo não estando na frente", () => {
    // max=2 força o cap: só os 2 Tier-1 cabem; os additionais (btts/double_chance)
    // são os candidatos a cair. match_result está por ÚLTIMO no input.
    const capped = capCandidates(wc, 2);
    const keys = capped.map((c) => c.key);
    expect(capped).toHaveLength(2);
    expect(keys).toContain("over_under");
    expect(keys).toContain("match_result");
    expect(keys).not.toContain("btts");
    expect(keys).not.toContain("double_chance");
  });

  it("mercado desconhecido (sem descriptor) é tratado como NÃO-Tier-1 (cai primeiro)", () => {
    const list = [
      { key: "btts" },
      { key: "fantasy_market" },
      { key: "over_under" },
      { key: "match_result" },
    ];
    const capped = capCandidates(list, 2);
    const keys = capped.map((c) => c.key);
    expect(keys).toEqual(["over_under", "match_result"]);
  });
});
