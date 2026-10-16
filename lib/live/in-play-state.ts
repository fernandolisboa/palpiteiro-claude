import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import {
  claimMatchLiveState,
  getMatchLiveState,
  getMatchLiveStatesForMatches,
  saveMatchLiveState,
  type MatchLiveState,
} from "@/lib/db/queries/match-live-states";
import type { DbMatch } from "@/lib/db/queries/matches";
import {
  IN_PLAY_FRESH_MS,
  IN_PLAY_WINDOW_AFTER_MS,
  IN_PLAY_WINDOW_BEFORE_MS,
  liveStateAgeMs,
} from "@/lib/live/freshness";
import {
  classifyStatusShort,
  isTerminalStatusShort,
  liveMinuteLabel,
  type LiveStateInput,
} from "@/lib/live/phase";
import {
  getLiveStateProvider,
  type NormalizedLiveState,
} from "@/lib/providers/live";

// Estado ao vivo de um jogo (#580, PLAN-580 §5.2): a row de `match_live_states` é o
// cache entre instâncias e o lease da busca mora nela (sem KV). Única camada que chama
// `getLiveStateProvider()`; a página e as actions leem por aqui, as listas leem as rows
// sem buscar (`getInPlayStatesForMatches`). Nenhum caminho daqui toca a The Odds API.

/** A busca só acontece em `[kickoff − 5 min, kickoff + 4h]` (§5.2 passo 1). */
export { IN_PLAY_WINDOW_AFTER_MS, IN_PLAY_WINDOW_BEFORE_MS };

export type InPlayMatch = Pick<
  DbMatch,
  "id" | "league" | "kickoffAt" | "homeTeam" | "awayTeam" | "status"
>;

/**
 * O que a página e as actions consomem. Satisfaz `LiveStateInput`, então vai direto em
 * `matchPhase(match, state, now, { liveMode })`. Só existe com uma busca bem-sucedida
 * (`fetchedAt` nunca null aqui): a row de lease sem dado vira `null`.
 */
export type InPlayState = LiveStateInput & {
  matchId: string;
  statusShort: string;
  fetchedAt: Date;
  /** Rótulo da tela ("63'", "45+2'", "intervalo"); null sem minuto conhecido. */
  minuteLabel: string | null;
  score: { home: number; away: number } | null;
  /** null = sem dado de expulsão. */
  red: { home: number; away: number } | null;
  /** Idade a partir da resposta do provider, no `now` da leitura. */
  ageMs: number;
};

function pair(
  home: number | null,
  away: number | null
): { home: number; away: number } | null {
  return home === null || away === null ? null : { home, away };
}

/**
 * Placar do estado. Atraso no apito (`NS`/`TBD` depois do horário, PLAN-580 §7): o
 * provider manda os gols null antes de a bola rolar, mas a fase é `in_play` no minuto 0,
 * acionável. Sem gol possível ainda, o placar é 0–0 (senão a tabela cairia em só
 * leitura e a action recusaria com "placar indisponível"). A row segue com o null cru.
 */
export function inPlayScore(
  statusShort: string,
  goals: { home: number; away: number } | null
): { home: number; away: number } | null {
  if (goals !== null) return goals;
  return classifyStatusShort(statusShort) === "pre_match"
    ? { home: 0, away: 0 }
    : null;
}

function toInPlayState(
  row: MatchLiveState | null,
  now: Date
): InPlayState | null {
  if (row === null || row.fetchedAt === null || row.statusShort === null) {
    return null;
  }
  return {
    matchId: row.matchId,
    statusShort: row.statusShort,
    elapsed: row.elapsed,
    extra: row.extra,
    fetchedAt: row.fetchedAt,
    minuteLabel: liveMinuteLabel(row),
    score: inPlayScore(row.statusShort, pair(row.homeGoals, row.awayGoals)),
    red: pair(row.homeRed, row.awayRed),
    ageMs: liveStateAgeMs(row.fetchedAt, now) ?? 0,
  };
}

function fromProvider(
  matchId: string,
  s: NormalizedLiveState,
  now: Date
): InPlayState {
  const fetched = {
    statusShort: s.statusShort,
    elapsed: s.elapsed,
    extra: s.extra,
  };
  return {
    matchId,
    ...fetched,
    fetchedAt: s.fetchedAt,
    minuteLabel: liveMinuteLabel(fetched),
    score: inPlayScore(s.statusShort, s.goals),
    red: s.red,
    ageMs: liveStateAgeMs(s.fetchedAt, now) ?? 0,
  };
}

function logFailure(
  event: "fetch_failed" | "save_failed",
  matchId: string,
  row: MatchLiveState | null,
  now: Date,
  err?: unknown
): void {
  console.warn(
    JSON.stringify({
      scope: "in-play-state",
      event,
      matchId,
      providerFixtureId: row?.providerFixtureId ?? null,
      staleAgeMs: liveStateAgeMs(row?.fetchedAt ?? null, now),
      ...(err !== undefined
        ? { message: err instanceof Error ? err.message : String(err) }
        : {}),
    })
  );
}

// DB já diz que o jogo não está rolando (o sync só grava terminal depois do fim):
// `matchPhase` deixa o DB vencer o estado, então buscar seria cota jogada fora.
function dbSaysNotLive(status: DbMatch["status"]): boolean {
  return status !== "scheduled" && status !== "live";
}

async function readOrFetch(
  match: InPlayMatch,
  now: Date,
  freshMs: number
): Promise<InPlayState | null> {
  const row = await getMatchLiveState(match.id);
  const age = liveStateAgeMs(row?.fetchedAt ?? null, now);
  if (age !== null && age <= freshMs) return toInPlayState(row, now);
  if (
    isTerminalStatusShort(row?.statusShort ?? null) ||
    dbSaysNotLive(match.status)
  ) {
    return toInPlayState(row, now);
  }

  if (!(await getEnableLiveMode())) return null;

  const provider = getLiveStateProvider();
  if (provider.isQuotaLow()) return toInPlayState(row, now);

  if (!(await claimMatchLiveState(match.id, now))) {
    return toInPlayState(row, now);
  }

  let fetched: NormalizedLiveState | null;
  try {
    fetched = await provider.getLiveState({
      ref: {
        league: match.league,
        kickoffAt: match.kickoffAt.toISOString(),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      },
      providerFixtureId: row?.providerFixtureId ?? null,
    });
  } catch (err) {
    // O contrato do provider é nunca lançar; isto é defesa, não caminho esperado.
    logFailure("fetch_failed", match.id, row, now, err);
    return toInPlayState(row, now);
  }
  if (fetched === null) {
    // O lease vence sozinho em LIVE_STATE_LEASE_MS; nada a soltar aqui.
    logFailure("fetch_failed", match.id, row, now);
    return toInPlayState(row, now);
  }

  try {
    await saveMatchLiveState({
      matchId: match.id,
      providerFixtureId: fetched.providerFixtureId,
      statusShort: fetched.statusShort,
      elapsed: fetched.elapsed,
      extra: fetched.extra,
      homeGoals: fetched.goals?.home ?? null,
      awayGoals: fetched.goals?.away ?? null,
      homeRed: fetched.red?.home ?? null,
      awayRed: fetched.red?.away ?? null,
      fetchedAt: fetched.fetchedAt,
    });
  } catch (err) {
    // A leitura é boa; só o cache entre instâncias ficou para a próxima.
    logFailure("save_failed", match.id, row, now, err);
  }
  return fromProvider(match.id, fetched, now);
}

// Coalescência por jogo nesta instância: dois Server Components (ou a página e uma
// action) no mesmo instante dividem uma leitura, um lease e uma busca. Só em voo.
const inFlight = new Map<string, Promise<InPlayState | null>>();

/**
 * Estado ao vivo do jogo, buscando no provider quando a row passou de `IN_PLAY_FRESH_MS`
 * (§5.2). Nunca lança por falha do provider: devolve a última leitura com a idade, ou
 * `null` sem nenhuma.
 *
 * - Antes da janela: `null`, sem ler o DB. Depois da janela: só a row terminal (o resto
 *   é `started_unknown` para `matchPhase`), sem buscar.
 * - `maxAgeMs`: até que idade a row serve sem buscar (as actions passam
 *   `IN_PLAY_ACT_MAX_AGE_MS`). Abaixo de `IN_PLAY_FRESH_MS` não tem efeito: o lease da
 *   row só libera a busca a partir dessa idade.
 * - Flag `enable_live_mode` desligada: `null` em vez de buscar.
 * - Chamadas concorrentes do mesmo jogo nesta instância recebem o resultado da primeira.
 */
export async function getInPlayState(
  match: InPlayMatch,
  { now = new Date(), maxAgeMs }: { now?: Date; maxAgeMs?: number } = {}
): Promise<InPlayState | null> {
  const kickoff = match.kickoffAt.getTime();
  const t = now.getTime();
  if (t < kickoff - IN_PLAY_WINDOW_BEFORE_MS) return null;
  if (t > kickoff + IN_PLAY_WINDOW_AFTER_MS) {
    const row = await getMatchLiveState(match.id);
    return isTerminalStatusShort(row?.statusShort ?? null)
      ? toInPlayState(row, now)
      : null;
  }

  const existing = inFlight.get(match.id);
  if (existing) return existing;
  const freshMs = Math.max(maxAgeMs ?? IN_PLAY_FRESH_MS, IN_PLAY_FRESH_MS);
  const promise = readOrFetch(match, now, freshMs).finally(() => {
    inFlight.delete(match.id);
  });
  inFlight.set(match.id, promise);
  return promise;
}

/**
 * Leitura em lote para as listas: só as rows, NUNCA busca no provider. Jogo sem leitura
 * bem-sucedida fica fora do mapa.
 */
export async function getInPlayStatesForMatches(
  matchIds: readonly string[],
  { now = new Date() }: { now?: Date } = {}
): Promise<Map<string, InPlayState>> {
  const rows = await getMatchLiveStatesForMatches(matchIds);
  const out = new Map<string, InPlayState>();
  for (const [id, row] of rows) {
    const s = toInPlayState(row, now);
    if (s !== null) out.set(id, s);
  }
  return out;
}
