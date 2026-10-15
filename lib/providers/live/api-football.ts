import {
  getLastQuota,
  type ObservedQuota,
} from "@/lib/providers/http/quota-logger";
import {
  API_FOOTBALL_LIVE_CLIENT_NAME,
  API_FOOTBALL_LIVE_TIMEOUT_MS,
  getFixtureLive,
  getFixturesByDate,
  type ApiFootballLiveFetch,
} from "@/lib/providers/sports-data/api-football/adapter";
import type { ApiFootballFixture } from "@/lib/providers/sports-data/api-football/schemas";
import {
  API_FOOTBALL_LEAGUE_IDS,
  currentSeason,
} from "@/lib/providers/sports-data/leagues";
import { canonicalizeOrPassthrough } from "@/lib/providers/sports-data/team-names";
import type { FixtureRef } from "@/lib/providers/sports-data/types";

import type {
  LiveStateProvider,
  LiveStateRequest,
  NormalizedLiveState,
} from "./types";

// Estado ao vivo pela API-Football (#591, PLAN-580 §5.1): `/fixtures?id=` pelo cliente
// próprio do ao vivo (adapter.getFixtureLive), normalizado pra NormalizedLiveState.
// Formato do payload ao vivo (`status.extra`, `events` junto na busca por id, texto do
// `detail` do segundo amarelo) INFERIDO da documentação: validar com a chave num jogo
// em andamento (pergunta 1 do PLAN-580 §17).

// Nome do cliente compartilhado (adapter.ts). A cota é da CONTA, então a leitura mais
// recente de qualquer um dos dois clientes vale pro freio.
const SHARED_CLIENT_NAME = "api-football";

// Abaixo de 5% do limite diário a busca ao vivo para (PLAN-580 §5.3). Por instância e
// zerado no cold start: é freio de segurança, o uso normal fica muito abaixo da cota.
export const LIVE_QUOTA_MIN_RATIO = 0.05;

// Leitura de cota mais velha que isto (ou de outro dia UTC, quando a cota diária zera)
// não freia: sem isso o freio se trancava, porque com ele ligado o cliente ao vivo não
// busca e nunca recebe um header novo.
export const LIVE_QUOTA_READING_MAX_AGE_MS = 15 * 60_000;

// "Red Card" e "Second Yellow card" (a caixa exata não é garantida pela documentação).
const RED_CARD_DETAIL = /red card|second yellow/i;

type QuotaReader = (provider: string) => ObservedQuota | null;

/**
 * true quando a última cota diária vista nesta instância (do cliente ao vivo ou do
 * compartilhado, a mais recente) está abaixo de LIVE_QUOTA_MIN_RATIO do limite. Sem
 * leitura, sem os headers de restante/limite, leitura velha ou de outro dia UTC → false
 * (não freia às cegas).
 */
export function isApiFootballQuotaLow(
  read: QuotaReader = getLastQuota,
  now: Date = new Date()
): boolean {
  const observed = [
    read(API_FOOTBALL_LIVE_CLIENT_NAME),
    read(SHARED_CLIENT_NAME),
  ].filter((q): q is ObservedQuota => q !== null);
  if (observed.length === 0) return false;
  const latest = observed.reduce((a, b) =>
    b.observedAt.getTime() > a.observedAt.getTime() ? b : a
  );
  if (latest.dailyRemaining === null || !latest.dailyLimit) return false;
  const at = latest.observedAt;
  if (now.getTime() - at.getTime() > LIVE_QUOTA_READING_MAX_AGE_MS)
    return false;
  if (at.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10))
    return false;
  return latest.dailyRemaining / latest.dailyLimit < LIVE_QUOTA_MIN_RATIO;
}

/**
 * Expulsões por time a partir dos eventos `Card` do fixture: `detail` com "red card" ou
 * "second yellow" (sem diferenciar maiúsculas), atribuídas por `team.id` contra
 * `teams.home.id`/`teams.away.id`. Um jogador só é expulso uma vez: o mesmo jogador
 * (id, ou nome sem id) do mesmo time conta uma vez, caso o provider mande o segundo
 * amarelo e o vermelho como dois eventos.
 *
 * null = sem dados: `events` ausente (ou descartado pelo schema), ou um cartão vermelho
 * que não dá pra atribuir a nenhum dos dois times (contar errado é pior que não saber).
 */
export function countRedCards(
  f: ApiFootballFixture
): { home: number; away: number } | null {
  if (f.events === undefined) return null;
  const homeId = f.teams.home.id;
  const awayId = f.teams.away.id;
  const seen = new Set<string>();
  let home = 0;
  let away = 0;
  for (const ev of f.events) {
    if (ev.type.toLowerCase() !== "card") continue;
    if (!RED_CARD_DETAIL.test(ev.detail ?? "")) continue;
    const teamId = ev.team?.id ?? null;
    const side =
      teamId !== null && teamId === homeId
        ? "home"
        : teamId !== null && teamId === awayId
          ? "away"
          : null;
    if (side === null) return null;
    const player = ev.player?.id ?? ev.player?.name ?? null;
    if (player !== null) {
      const key = `${side}:${player}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (side === "home") home += 1;
    else away += 1;
  }
  return { home, away };
}

export function toNormalizedLiveState(
  f: ApiFootballFixture,
  fetchedAt: Date
): NormalizedLiveState {
  const { home, away } = f.goals;
  return {
    providerFixtureId: f.fixture.id,
    statusShort: f.fixture.status.short,
    elapsed: f.fixture.status.elapsed,
    extra: f.fixture.status.extra ?? null,
    goals: home !== null && away !== null ? { home, away } : null,
    red: countRedCards(f),
    fetchedAt,
  };
}

/**
 * Fixture do jogo pelo dia (UTC do kickoff) + liga, casando os nomes canônicos: o MESMO
 * padrão de getFixtureResult (adapter.ts), e a MESMA chave de cache de 1h de
 * getFixturesByDate, compartilhada com o predict. undefined = não achou.
 */
export function findFixtureForRef(
  fixtures: ApiFootballFixture[],
  ref: FixtureRef
): ApiFootballFixture | undefined {
  return fixtures.find(
    (f) =>
      canonicalizeOrPassthrough(f.teams.home.name, ref.league) ===
        ref.homeTeam &&
      canonicalizeOrPassthrough(f.teams.away.name, ref.league) === ref.awayTeam
  );
}

class LiveCeilingError extends Error {
  constructor(ms: number) {
    super(`live state fetch exceeded ${ms}ms`);
    this.name = "LiveCeilingError";
  }
}

function withCeiling<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LiveCeilingError(ms)), ms);
  });
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer));
}

export type ApiFootballLiveDeps = {
  fetchLive: (id: number) => Promise<ApiFootballLiveFetch>;
  fixturesByDate: (
    date: string,
    leagueId: number,
    season: number
  ) => Promise<ApiFootballFixture[]>;
  readQuota: QuotaReader;
  // Teto do caminho inteiro (resolução + busca): o render da página espera por isto.
  ceilingMs: number;
};

const DEFAULT_DEPS: ApiFootballLiveDeps = {
  fetchLive: (id) => getFixtureLive(id),
  fixturesByDate: (date, leagueId, season) =>
    getFixturesByDate(date, leagueId, season),
  readQuota: getLastQuota,
  ceilingMs: API_FOOTBALL_LIVE_TIMEOUT_MS,
};

type Outcome =
  | { ok: true; state: NormalizedLiveState }
  | { ok: false; error: "fixture_not_resolved" | "fixture_not_found" };

export class ApiFootballLiveStateProvider implements LiveStateProvider {
  readonly name = "api_football" as const;
  private readonly deps: ApiFootballLiveDeps;

  constructor(deps: Partial<ApiFootballLiveDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  isQuotaLow(): boolean {
    return isApiFootballQuotaLow(this.deps.readQuota);
  }

  async getLiveState(
    req: LiveStateRequest
  ): Promise<NormalizedLiveState | null> {
    const logBase = {
      scope: "live-state",
      provider: "api-football",
      league: req.ref.league,
      kickoffAt: req.ref.kickoffAt,
      homeTeam: req.ref.homeTeam,
      awayTeam: req.ref.awayTeam,
      providerFixtureId: req.providerFixtureId ?? null,
    };
    if (this.isQuotaLow()) {
      console.warn(JSON.stringify({ ...logBase, error: "quota_low" }));
      return null;
    }
    try {
      const outcome = await withCeiling(this.fetch(req), this.deps.ceilingMs);
      if (outcome.ok) return outcome.state;
      console.warn(JSON.stringify({ ...logBase, error: outcome.error }));
      return null;
    } catch (err) {
      console.error(
        JSON.stringify({
          ...logBase,
          error: err instanceof LiveCeilingError ? "ceiling" : "fetch_failed",
          errorName: err instanceof Error ? err.name : typeof err,
          message: err instanceof Error ? err.message : String(err),
        })
      );
      return null;
    }
  }

  private async fetch(req: LiveStateRequest): Promise<Outcome> {
    const id = req.providerFixtureId ?? (await this.resolveFixtureId(req.ref));
    if (id === null) return { ok: false, error: "fixture_not_resolved" };
    const { fixture, fetchedAt } = await this.deps.fetchLive(id);
    if (!fixture) return { ok: false, error: "fixture_not_found" };
    return { ok: true, state: toNormalizedLiveState(fixture, fetchedAt) };
  }

  private async resolveFixtureId(ref: FixtureRef): Promise<number | null> {
    const fixtures = await this.deps.fixturesByDate(
      ref.kickoffAt.slice(0, 10),
      API_FOOTBALL_LEAGUE_IDS[ref.league],
      currentSeason(ref.league)
    );
    return findFixtureForRef(fixtures, ref)?.fixture.id ?? null;
  }
}
