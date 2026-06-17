import { describe, expect, it } from "vitest";

import { OddsEnvelopeSchema } from "@/lib/providers/odds/api-football/schemas";

// Envelope real do /odds?bet=10 (odds como STRING; "2:1" + bucket textual).
const envelope = {
  get: "odds",
  parameters: { league: "71", season: "2026", bet: "10" },
  errors: [],
  results: 1,
  paging: { current: 1, total: 1 },
  response: [
    {
      league: { id: 71, season: 2026 },
      fixture: { id: 12345, timezone: "UTC", date: "2026-07-22T23:00:00+00:00" },
      update: "2026-07-22T20:00:00+00:00",
      bookmakers: [
        {
          id: 8,
          name: "Bet365",
          bets: [
            {
              id: 10,
              name: "Exact Score",
              values: [
                { value: "1:0", odd: "8.50" },
                { value: "2:1", odd: "11.00" },
                { value: "Any Other Score", odd: "3.20" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("OddsEnvelopeSchema", () => {
  it("valida o envelope do /odds e descarta chaves extras do fio", () => {
    const parsed = OddsEnvelopeSchema.parse(envelope);
    expect(parsed.response).toHaveLength(1);
    const item = parsed.response[0];
    expect(item.fixture.id).toBe(12345);
    expect(item.update).toBe("2026-07-22T20:00:00+00:00");
    // odds seguem STRING no fio (o adapter faz parseFloat).
    expect(item.bookmakers[0].bets[0].values[0].odd).toBe("8.50");
    // chaves extras (league, timezone) são descartadas pelo Zod.
    expect("league" in item).toBe(false);
  });

  it("rejeita envelope malformado (values sem odd)", () => {
    const bad = {
      ...envelope,
      response: [
        {
          fixture: { id: 1 },
          bookmakers: [
            { id: 8, name: "Bet365", bets: [{ id: 10, name: "x", values: [{ value: "1:0" }] }] },
          ],
        },
      ],
    };
    expect(OddsEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});
