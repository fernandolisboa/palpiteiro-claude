import { beforeEach, describe, expect, it, vi } from "vitest";

import { TheOddsApiAdapter } from "@/lib/providers/odds/the-odds-api/adapter";
import {
  NormalizedOddsEventListItemSchema,
  NormalizedOddsEventSchema,
} from "@/lib/providers/odds/types";
import {
  getEventsForSport,
  getOddsForEvent,
  getOddsForSport,
  OddsApiHttpError,
} from "@/lib/providers/odds-api";
import type {
  OddsApiEventListItem,
  OddsApiEventOdds,
} from "@/lib/providers/odds-api-schemas";

// Mocka só as 3 funções de fetch; preserva as classes de erro REAIS (importActual)
// pra exercitar a propagação do erro de fio pelo adapter.
vi.mock("@/lib/providers/odds-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/providers/odds-api")>()),
  getOddsForSport: vi.fn(),
  getOddsForEvent: vi.fn(),
  getEventsForSport: vi.fn(),
}));

// Payload de fio (snake_case) com totals (com `point`) e h2h (sem `point`).
const wireEvent: OddsApiEventOdds = {
  id: "evt-1",
  sport_key: "soccer_brazil_campeonato",
  sport_title: "Brasileirão",
  commence_time: "2026-07-22T23:00:00Z",
  home_team: "Flamengo",
  away_team: "Palmeiras",
  bookmakers: [
    {
      key: "betfair_ex_eu",
      title: "Betfair",
      last_update: "2026-07-22T20:00:00Z",
      markets: [
        {
          key: "totals",
          last_update: "2026-07-22T20:00:00Z",
          outcomes: [
            { name: "Over", price: 1.95, point: 2.5 },
            { name: "Under", price: 1.9, point: 2.5 },
          ],
        },
        {
          key: "h2h",
          last_update: "2026-07-22T20:01:00Z",
          outcomes: [
            { name: "Flamengo", price: 2.1 },
            { name: "Draw", price: 3.2 },
            { name: "Palmeiras", price: 3.5 },
          ],
        },
      ],
    },
  ],
};

describe("TheOddsApiAdapter", () => {
  const adapter = new TheOddsApiAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("capabilities expõe name + ligas suportadas", () => {
    expect(adapter.capabilities.name).toBe("the-odds-api");
    expect(adapter.capabilities.supportedLeagues.has("brasileirao_a")).toBe(
      true,
    );
    expect(adapter.capabilities.supportedLeagues.has("champions_league")).toBe(
      true,
    );
    expect(adapter.capabilities.supportedLeagues.has("world_cup")).toBe(true);
  });

  it("getOddsForSport normaliza snake→camel sem transformar valores", async () => {
    vi.mocked(getOddsForSport).mockResolvedValue([wireEvent]);

    const [event] = await adapter.getOddsForSport("soccer_brazil_campeonato", {
      markets: ["totals"],
      regions: ["eu"],
    });

    // Estrutura camelCase válida e sem campos de fio remanescentes.
    expect(NormalizedOddsEventSchema.parse(event)).toEqual(event);
    expect(event).toEqual({
      id: "evt-1",
      commenceTime: "2026-07-22T23:00:00Z",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
      bookmakers: [
        {
          key: "betfair_ex_eu",
          title: "Betfair",
          markets: [
            {
              key: "totals",
              lastUpdate: "2026-07-22T20:00:00Z",
              outcomes: [
                { name: "Over", price: 1.95, point: 2.5 },
                { name: "Under", price: 1.9, point: 2.5 },
              ],
            },
            {
              key: "h2h",
              lastUpdate: "2026-07-22T20:01:00Z",
              outcomes: [
                { name: "Flamengo", price: 2.1 },
                { name: "Draw", price: 3.2 },
                { name: "Palmeiras", price: 3.5 },
              ],
            },
          ],
        },
      ],
    });

    // `point` é OMITIDO (não `undefined`) em outcomes sem linha (h2h).
    expect("point" in event.bookmakers[0].markets[1].outcomes[0]).toBe(false);
    // Valores numéricos passam verbatim (sem Number()/round/coerção a string).
    expect(typeof event.bookmakers[0].markets[0].outcomes[0].price).toBe(
      "number",
    );

    // sportKey + options repassados VERBATIM ao cliente de fio.
    expect(getOddsForSport).toHaveBeenCalledWith("soccer_brazil_campeonato", {
      markets: ["totals"],
      regions: ["eu"],
    });
  });

  it("getOddsForEvent normaliza o evento único", async () => {
    vi.mocked(getOddsForEvent).mockResolvedValue(wireEvent);

    const event = await adapter.getOddsForEvent(
      "soccer_brazil_campeonato",
      "evt-1",
      { markets: ["btts"], regions: ["eu"] },
    );

    expect(event.commenceTime).toBe("2026-07-22T23:00:00Z");
    expect(event.homeTeam).toBe("Flamengo");
    expect(getOddsForEvent).toHaveBeenCalledWith(
      "soccer_brazil_campeonato",
      "evt-1",
      { markets: ["btts"], regions: ["eu"] },
    );
  });

  it("getEventsForSport normaliza itens da lista (sem bookmakers)", async () => {
    const wireList: OddsApiEventListItem[] = [
      {
        id: "evt-1",
        sport_key: "soccer_brazil_campeonato",
        commence_time: "2026-07-22T23:00:00Z",
        home_team: "Flamengo",
        away_team: "Palmeiras",
      },
    ];
    vi.mocked(getEventsForSport).mockResolvedValue(wireList);

    const [item] = await adapter.getEventsForSport("soccer_brazil_campeonato");

    expect(NormalizedOddsEventListItemSchema.parse(item)).toEqual(item);
    expect(item).toEqual({
      id: "evt-1",
      commenceTime: "2026-07-22T23:00:00Z",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
    });
  });

  it("propaga o erro do cliente de fio SEM ENVELOPAR (#288: cascade fica pro #289)", async () => {
    // Contrato inegociável de #288: o adapter NÃO mapeia OddsApiError pra uma
    // hierarquia própria (byte-idêntico). O MESMO objeto de erro propaga — o
    // OddsFallbackProvider do #289 é quem vai introduzir o cascade.
    const wireErr = new OddsApiHttpError(
      "Transient HTTP 502 on /sports/x/odds",
      "/sports/x/odds",
      {},
      502,
      "bad gateway",
    );
    vi.mocked(getOddsForSport).mockRejectedValue(wireErr);
    await expect(
      adapter.getOddsForSport("soccer_brazil_campeonato", {
        markets: ["totals"],
      }),
    ).rejects.toBe(wireErr); // mesma instância, sem wrap (name/message/classe idênticos)
  });
});
