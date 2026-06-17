import { SPORT_KEY_BY_LEAGUE } from "@/lib/providers/odds-api-constants";
import { getOddsByBetId } from "@/lib/providers/odds/api-football/client";
import {
  ANYTIME_SCORER_PROVIDER_KEY,
  ASSIST_PROVIDER_KEY,
  BET_ID_ANYTIME_SCORER,
  BET_ID_ASSIST,
  BET_ID_CORRECT_SCORE,
  CORRECT_SCORE_PROVIDER_KEY,
} from "@/lib/providers/odds/api-football/constants";
import type { ApiFootballOddsItem } from "@/lib/providers/odds/api-football/schemas";
import type {
  GetEventsForSportOptions,
  GetOddsForEventOptions,
  GetOddsForSportOptions,
  NormalizedOddsEvent,
  NormalizedOddsEventListItem,
  OddsProvider,
  OddsProviderCapabilities,
} from "@/lib/providers/odds/types";
import { getFixturesByLeague } from "@/lib/providers/sports-data/api-football/adapter";
import type { ApiFootballFixture } from "@/lib/providers/sports-data/api-football/schemas";
import {
  API_FOOTBALL_LEAGUE_IDS,
  currentSeason,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

// Só o Brasileirão cota correct score (bet=10) — ADR 0025 §1.
const SUPPORTED_LEAGUE: SupportedLeague = "brasileirao_a";
const SUPPORTED_SPORT_KEY: string = SPORT_KEY_BY_LEAGUE[SUPPORTED_LEAGUE];

const CAPABILITIES: OddsProviderCapabilities = {
  name: "api-football-odds",
  supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
};

// Mapa providerMarketKey → bet id da api-football (#289 correct_score; #290 scorer/
// assist). O OddsFallbackProvider roteia por supportsMarket sobre ESTAS keys; o
// getOddsForSport resolve o bet id daqui (data-driven, sem `if (market === X)`).
const BET_ID_BY_PROVIDER_KEY: Record<string, number> = {
  [CORRECT_SCORE_PROVIDER_KEY]: BET_ID_CORRECT_SCORE,
  [ANYTIME_SCORER_PROVIDER_KEY]: BET_ID_ANYTIME_SCORER,
  [ASSIST_PROVIDER_KEY]: BET_ID_ASSIST,
};

// Rename de campo + parseFloat (fio é STRING) — sem outros transforms. Times +
// commenceTime NÃO vêm no /odds (só fixture.id) → enriquecidos pela metadata de
// fixture (`fx`). `point` ausente (estes mercados não têm linha). FILTRA pelo
// `betId` pedido e estampa o `providerKey` pedido em NormalizedOddsMarket.key (o
// roteador casa contra descriptor.providerMarketKey). Outcomes passam VERBATIM (o
// grid/drop de correct_score ou o keying por jogador do scorer acontece no
// descriptor.resolveSelectionKey, igual ao the-odds-api adapter). Funciona idêntico
// pra correct_score (1 bet com 16 values) e scorer/assist (1 bet com N values
// yes-only por jogador) — a forma do payload é a MESMA, só muda o conteúdo do value.
function normalizeOddsItem(
  item: ApiFootballOddsItem,
  fx: ApiFootballFixture,
  betId: number,
  providerKey: string,
): NormalizedOddsEvent {
  return {
    id: String(item.fixture.id),
    commenceTime: fx.fixture.date,
    homeTeam: fx.teams.home.name,
    awayTeam: fx.teams.away.name,
    bookmakers: item.bookmakers.map((b) => ({
      key: `apifootball_${b.id}`,
      title: b.name,
      markets: b.bets
        .filter((bet) => bet.id === betId)
        .map((bet) => ({
          key: providerKey,
          // api-football carrega `update` no nível do item (por fixture); o fio NÃO
          // foi confirmado ao vivo pra estes bets → fallback pro now. lastUpdate é só
          // input do LLM (não o captured_at persistido), então o fallback é seguro.
          lastUpdate: item.update ?? new Date().toISOString(),
          outcomes: bet.values.map((v) => ({
            name: v.value,
            price: Number.parseFloat(v.odd),
          })),
        })),
    })),
  };
}

/**
 * Segundo OddsProvider (#289/#290, ADR 0025): correct score (bet=10), artilheiro
 * (bet=92) e assistência (bet=212) da api-football pro Brasileirão. Roteado pelo
 * OddsFallbackProvider por capability (supportsMarket) — NUNCA por nome de provider.
 * Mercados fora deste set continuam na The Odds API (byte-idêntico ao #288). bet=93
 * (first scorer) NÃO entra (diferido na emenda da ADR 0025). Wire bet=92/212 NÃO
 * verificado ao vivo (liga pausada) → prefer-skip, inspecionar 1º payload real.
 *
 * `/odds` traz só `fixture.id` (sem times) → o adapter junta com a metadata de
 * fixture (getFixturesByLeague, cached, mesmo vendor/chave) pra preencher
 * homeTeam/awayTeam/commenceTime — senão `findEventInList` (que casa por nome)
 * nunca parearia. Erros do fio PROPAGAM (consistente com #288).
 */
export class ApiFootballOddsAdapter implements OddsProvider {
  readonly capabilities = CAPABILITIES;

  supportsMarket(args: {
    sportKey: string;
    providerMarketKey: string;
  }): boolean {
    return (
      args.sportKey === SUPPORTED_SPORT_KEY &&
      args.providerMarketKey in BET_ID_BY_PROVIDER_KEY
    );
  }

  async getOddsForSport(
    sportKey: string,
    options?: GetOddsForSportOptions,
  ): Promise<NormalizedOddsEvent[]> {
    // Capability gate (defensivo; o composite já roteia por supportsMarket): só BR
    // cota estes mercados → "sem cobertura" pra qualquer outra liga (não throw:
    // empty é a resposta natural de um provider pra liga que ele não cobre).
    if (sportKey !== SUPPORTED_SPORT_KEY) return [];

    // Resolve o mercado pedido (data-driven, NUNCA `if (market === X)`). Default
    // = correct_score (bet_10), preservando o caminho byte-idêntico do #289 pros
    // callers de 1 argumento. markets[0] é a única key (call sites passam 1).
    const providerKey = options?.markets?.[0] ?? CORRECT_SCORE_PROVIDER_KEY;
    const betId = BET_ID_BY_PROVIDER_KEY[providerKey];
    if (betId === undefined) return []; // mercado não coberto por este adapter

    const leagueId = API_FOOTBALL_LEAGUE_IDS[SUPPORTED_LEAGUE];
    const season = currentSeason(SUPPORTED_LEAGUE);
    const [oddsItems, fixtures] = await Promise.all([
      getOddsByBetId(leagueId, season, betId),
      getFixturesByLeague(leagueId, season),
    ]);
    const fixtureById = new Map(fixtures.map((f) => [f.fixture.id, f]));

    const events: NormalizedOddsEvent[] = [];
    for (const item of oddsItems) {
      const fx = fixtureById.get(item.fixture.id);
      if (!fx) continue; // sem metadata → não dá pra parear por nome; degrada
      events.push(normalizeOddsItem(item, fx, betId, providerKey));
    }
    return events;
  }

  async getOddsForEvent(
    _sportKey: string,
    _eventId: string,
    _options?: GetOddsForEventOptions,
  ): Promise<NormalizedOddsEvent> {
    // Correct score é FEATURED/batch (/odds da liga) — não há caminho por evento.
    throw new Error(
      "ApiFootballOddsAdapter.getOddsForEvent: não suportado (correct score é batch; use getOddsForSport)",
    );
  }

  async getEventsForSport(
    _sportKey: string,
    _options?: GetEventsForSportOptions,
  ): Promise<NormalizedOddsEventListItem[]> {
    // A lista grátis de eventos é da The Odds API (o composite hardwira pra lá).
    throw new Error(
      "ApiFootballOddsAdapter.getEventsForSport: não suportado (lista de eventos vem da The Odds API)",
    );
  }
}
