import { describe, expect, it } from "vitest";

import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";

describe("PAGE_LIVE_MARKETS — contrato de pré-warm do card ao vivo (#173 PR-2)", () => {
  it("é exatamente over_under + match_result (quota: +1 crédito de liga por refresh)", () => {
    expect(PAGE_LIVE_MARKETS.map((d) => d.dbMarketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
  });

  it("todos FEATURED (batch) — nunca additional (per-evento queimaria quota no load)", () => {
    for (const d of PAGE_LIVE_MARKETS) {
      expect(d.oddsSource).not.toBe("additional");
    }
  });
});
