import {
  getEventsForSport as getEventsForSportWire,
  getOddsForEvent as getOddsForEventWire,
  getOddsForSport as getOddsForSportWire,
} from "@/lib/providers/odds-api";
import { SPORT_KEY_BY_LEAGUE } from "@/lib/providers/odds-api-constants";
import type {
  OddsApiEventListItem,
  OddsApiEventOdds,
} from "@/lib/providers/odds-api-schemas";
import type {
  GetEventsForSportOptions,
  GetOddsForEventOptions,
  GetOddsForSportOptions,
  NormalizedOddsEvent,
  NormalizedOddsEventListItem,
  OddsProvider,
  OddsProviderCapabilities,
} from "@/lib/providers/odds/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// Rename de campo APENAS (wire snake_case → DTO camelCase). NENHUM transform de
// valor: price/point/lastUpdate passam VERBATIM, garantindo que todo cálculo
// downstream (overround, .toFixed(3) na persistência, computeMarketScenarios)
// fique byte-idêntico. `point` é incluído só quando presente no fio (preserva a
// identidade estrutural — h2h/btts não têm point).
function normalizeEvent(wire: OddsApiEventOdds): NormalizedOddsEvent {
  return {
    id: wire.id,
    commenceTime: wire.commence_time,
    homeTeam: wire.home_team,
    awayTeam: wire.away_team,
    bookmakers: wire.bookmakers.map((b) => ({
      key: b.key,
      title: b.title,
      markets: b.markets.map((m) => ({
        key: m.key,
        lastUpdate: m.last_update,
        outcomes: m.outcomes.map((o) => ({
          name: o.name,
          price: o.price,
          ...(o.point !== undefined ? { point: o.point } : {}),
        })),
      })),
    })),
  };
}

function normalizeListItem(
  wire: OddsApiEventListItem,
): NormalizedOddsEventListItem {
  return {
    id: wire.id,
    commenceTime: wire.commence_time,
    homeTeam: wire.home_team,
    awayTeam: wire.away_team,
  };
}

const CAPABILITIES: OddsProviderCapabilities = {
  name: "the-odds-api",
  // Ligas com sportKey mapeado (fonte única: SPORT_KEY_BY_LEAGUE). Adicionar uma
  // liga lá a inclui aqui automaticamente.
  supportedLeagues: new Set(
    Object.keys(SPORT_KEY_BY_LEAGUE) as SupportedLeague[],
  ),
};

/**
 * Adapter da The Odds API — o PRIMEIRO `OddsProvider` (#288, ADR 0025). É o ÚNICO
 * módulo que importa os tipos de fio (`OddsApiEventOdds`/`OddsApiOutcome`/
 * `OddsApiEventListItem`) e o cliente `odds-api.ts`; todo o resto depende do DTO
 * `NormalizedOdds`. Espelha a forma de `ApiFootballAdapter` (sports-data).
 *
 * Erros do cliente de fio (`OddsApiError` & subtipos) **propagam SEM ALTERAÇÃO**
 * em #288 (byte-idêntico — os catches a jeito de `err.message`/control-flow
 * ficam idênticos). O mapeamento pra uma hierarquia de erro/cascade +
 * `OddsFallbackProvider` é do #289 (ADR 0025: o cascade é replicado lá).
 */
export class TheOddsApiAdapter implements OddsProvider {
  readonly capabilities = CAPABILITIES;

  async getOddsForSport(
    sportKey: string,
    options?: GetOddsForSportOptions,
  ): Promise<NormalizedOddsEvent[]> {
    const events = await getOddsForSportWire(sportKey, options);
    return events.map(normalizeEvent);
  }

  async getOddsForEvent(
    sportKey: string,
    eventId: string,
    options?: GetOddsForEventOptions,
  ): Promise<NormalizedOddsEvent> {
    const event = await getOddsForEventWire(sportKey, eventId, options);
    return normalizeEvent(event);
  }

  async getEventsForSport(
    sportKey: string,
    options?: GetEventsForSportOptions,
  ): Promise<NormalizedOddsEventListItem[]> {
    const events = await getEventsForSportWire(sportKey, options);
    return events.map(normalizeListItem);
  }
}
