import { SPORT_KEY_BY_LEAGUE } from "@/lib/providers/odds-api-constants";
import { getCorrectScoreOdds } from "@/lib/providers/odds/api-football/client";
import {
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

// Rename de campo + parseFloat (fio é STRING) — sem outros transforms. Times +
// commenceTime NÃO vêm no /odds (só fixture.id) → enriquecidos pela metadata de
// fixture (`fx`). `point` ausente (correct score não tem linha). O grid 16-células
// + drop de fora-do-grid acontece em CORRECT_SCORE.resolveSelectionKey (o adapter
// passa TODOS os outcomes verbatim, igual ao the-odds-api adapter).
function normalizeOddsItem(
  item: ApiFootballOddsItem,
  fx: ApiFootballFixture,
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
        .filter((bet) => bet.id === BET_ID_CORRECT_SCORE)
        .map((bet) => ({
          key: CORRECT_SCORE_PROVIDER_KEY,
          // api-football carrega `update` no nível do item (por fixture); o fio NÃO
          // foi confirmado ao vivo pro bet=10 → fallback pro now. lastUpdate é só
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
 * Segundo OddsProvider (#289, ADR 0025): correct score (bet=10) da api-football pro
 * Brasileirão. Roteado pelo OddsFallbackProvider por capability (supportsMarket) —
 * NUNCA por nome de provider. Mercados não-correct-score continuam na The Odds API
 * (byte-idêntico ao #288). Scorer/assist (bet=92/93/212) ficam pro #290.
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
      args.providerMarketKey === CORRECT_SCORE_PROVIDER_KEY &&
      args.sportKey === SUPPORTED_SPORT_KEY
    );
  }

  async getOddsForSport(
    sportKey: string,
    _options?: GetOddsForSportOptions,
  ): Promise<NormalizedOddsEvent[]> {
    // Capability gate (defensivo; o composite já roteia por supportsMarket): só BR
    // cota correct score → "sem cobertura" pra qualquer outra liga (não throw: empty
    // é a resposta natural de um provider pra liga que ele não cobre).
    if (sportKey !== SUPPORTED_SPORT_KEY) return [];

    const leagueId = API_FOOTBALL_LEAGUE_IDS[SUPPORTED_LEAGUE];
    const season = currentSeason(SUPPORTED_LEAGUE);
    const [oddsItems, fixtures] = await Promise.all([
      getCorrectScoreOdds(leagueId, season),
      getFixturesByLeague(leagueId, season),
    ]);
    const fixtureById = new Map(fixtures.map((f) => [f.fixture.id, f]));

    const events: NormalizedOddsEvent[] = [];
    for (const item of oddsItems) {
      const fx = fixtureById.get(item.fixture.id);
      if (!fx) continue; // sem metadata → não dá pra parear por nome; degrada
      events.push(normalizeOddsItem(item, fx));
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
