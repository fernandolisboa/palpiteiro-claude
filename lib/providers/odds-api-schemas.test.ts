import { describe, expect, it } from "vitest";

import {
  BookmakerSchema,
  EventOddsSchema,
} from "@/lib/providers/odds-api-schemas";

describe("odds-api-schemas — bookmaker last_update tolerance", () => {
  // Payload REAL capturado da The Odds API (1xBet/onexbet, região eu, mercado
  // `double_chance`, soccer_fifa_world_cup): o bookmaker NÃO traz `last_update`
  // no nível do bookmaker — só o `market` traz. Antes da correção isso fazia o
  // EventOddsSchema inteiro falhar e a dupla chance nunca ter odds.
  const bookmakerWithoutLastUpdate = {
    key: "onexbet",
    title: "1xBet",
    markets: [
      {
        key: "double_chance",
        last_update: "2026-06-14T14:29:15Z",
        outcomes: [
          { name: "Germany or Draw", price: 1.0 },
          { name: "Curaçao or Draw", price: 14.5 },
          { name: "Curaçao or Germany", price: 1.01 },
        ],
      },
    ],
  };

  it("aceita um bookmaker SEM last_update (só o market tem)", () => {
    const parsed = BookmakerSchema.safeParse(bookmakerWithoutLastUpdate);
    expect(parsed.success).toBe(true);
  });

  it("ainda EXIGE last_update no nível do market (consumido como capturedAt)", () => {
    const noMarketLastUpdate = {
      ...bookmakerWithoutLastUpdate,
      markets: [
        {
          key: "double_chance",
          outcomes: bookmakerWithoutLastUpdate.markets[0].outcomes,
        },
      ],
    };
    expect(BookmakerSchema.safeParse(noMarketLastUpdate).success).toBe(false);
  });

  it("parseia o evento double_chance inteiro com o bookmaker sem last_update", () => {
    const event = {
      id: "d79edbd6aaeb578d33e313446b18d333",
      sport_key: "soccer_fifa_world_cup",
      sport_title: "FIFA World Cup",
      commence_time: "2026-06-14T17:00:00Z",
      home_team: "Germany",
      away_team: "Curaçao",
      bookmakers: [bookmakerWithoutLastUpdate],
    };
    expect(EventOddsSchema.safeParse(event).success).toBe(true);
  });
});
