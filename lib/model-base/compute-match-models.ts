import { resolveModelBaseJudgments, type JudgmentRun } from "@/lib/ai/predict";
import { hasTypeSafeKey } from "@/lib/ai/providers/typesafe/client";
import { getEnableMatchModelJev } from "@/lib/db/queries/ai-config";
import { getActiveLeagues } from "@/lib/db/queries/league-settings";
import {
  getLatestMatchModelSnapshotsForMatches,
  insertMatchModelSnapshot,
  touchMatchModelSnapshot,
} from "@/lib/db/queries/match-model-snapshots";
import { getMatchesInLeagueWindow, type DbMatch } from "@/lib/db/queries/matches";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { isNeutralVenue } from "@/lib/providers/sports-data/neutral-venue";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { getModelScoreline } from "@/lib/ratings/model-scoreline";
import { acquireKvLock, releaseKvLock } from "@/lib/sync/lock";

import { buildMatchModelSnapshot } from "./build-snapshot";
import { fetchMatchJudgmentData } from "./judgment-data";
import type { MatchModelSnapshot } from "./types";

// Cron da base do modelo por jogo (#555, ADR 0052): pra cada jogo agendado das ligas
// ativas nos próximos 7 dias, λ (Dixon-Coles ou heurístico) → JEV a ≤48h (atrás do
// flag, fila priorizada e prazo) → row nova só quando o fingerprint muda. Sem Claude e
// sem The Odds API. Falha de um jogo ou liga não derruba o resto.

export const MODEL_BASE_WINDOW_HOURS = 7 * 24;
export const JEV_WINDOW_MS = 48 * 60 * 60 * 1000;
// Base com JEV mais velha que isto volta pro começo da fila JEV.
export const JEV_STALE_MS = 6 * 60 * 60 * 1000;
// Prazo pra COMEÇAR um jogo da fila JEV. Pior caso por jogo ≈ 7 req a 8/min na
// API-Football (~55 s) + JEV (~15 s) ≈ 70 s ⇒ 200 + 70 = 270 s < maxDuration 300.
export const RUN_DEADLINE_MS = 200_000;
export const COMPUTE_MATCH_MODELS_LOCK_KEY = "model-base:compute:lock";
// = maxDuration da rota: um run que morre no meio libera o lock pelo TTL.
const LOCK_TTL_MS = 300_000;

const SCOPE = "compute_match_models";

export type ComputeMatchModelsSummary = {
  skipped?: "locked";
  jevEnabled: boolean;
  jevMissingKey: boolean;
  leagues: { league: SupportedLeague; matches: number; error: boolean }[];
  considered: number;
  inserted: number;
  unchanged: number;
  noModel: number;
  errors: number;
  jev: {
    queued: number;
    applied: number;
    reused: number;
    failed: number;
    dataUnavailable: number;
    skippedDeadline: number;
    skippedMissingKey: number;
  };
};

function emptySummary(): ComputeMatchModelsSummary {
  return {
    jevEnabled: false,
    jevMissingKey: false,
    leagues: [],
    considered: 0,
    inserted: 0,
    unchanged: 0,
    noModel: 0,
    errors: 0,
    jev: {
      queued: 0,
      applied: 0,
      reused: 0,
      failed: 0,
      dataUnavailable: 0,
      skippedDeadline: 0,
      skippedMissingKey: 0,
    },
  };
}

/**
 * Ordem da fila JEV (puro). Bucket 0: jogo sem base, base sem JEV (`not_attempted`) ou
 * base com `checked_at` mais velho que JEV_STALE_MS; bucket 1: o resto (JEV fresco).
 * Dentro do bucket, kickoff mais próximo primeiro. O que não cabe no prazo do run
 * entra no próximo.
 */
export function orderJevQueue<T extends { matchId: string; kickoffAt: Date }>(
  items: T[],
  latestByMatch: Map<string, MatchModelSnapshot>,
  now: Date,
): T[] {
  const bucket = (item: T): number => {
    const latest = latestByMatch.get(item.matchId);
    if (!latest || latest.jevStatus === "not_attempted") return 0;
    return now.getTime() - latest.checkedAt.getTime() > JEV_STALE_MS ? 0 : 1;
  };
  return [...items].sort(
    (a, b) =>
      bucket(a) - bucket(b) || a.kickoffAt.getTime() - b.kickoffAt.getTime(),
  );
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ scope: SCOPE, event, ...fields }));
}

const errMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

type JevQueueItem = {
  matchId: string;
  kickoffAt: Date;
  match: DbMatch;
  scoreline: ModelScoreline;
  neutral: boolean;
};

export async function computeMatchModels(
  opts: { now?: Date; leagues?: readonly SupportedLeague[] } = {},
): Promise<ComputeMatchModelsSummary> {
  // Runs sobrepostos (cron + invocação manual/retry): o perdedor sai sem tocar em
  // provider nem DB.
  if (!(await acquireKvLock(COMPUTE_MATCH_MODELS_LOCK_KEY, { ttlMs: LOCK_TTL_MS }))) {
    const summary = { ...emptySummary(), skipped: "locked" as const };
    console.log(JSON.stringify({ scope: SCOPE, event: "skipped_locked" }));
    return summary;
  }
  try {
    return await runComputeMatchModels(opts);
  } finally {
    await releaseKvLock(COMPUTE_MATCH_MODELS_LOCK_KEY).catch((err: unknown) =>
      logError("lock_release_failed", { message: errMessage(err) }),
    );
  }
}

async function runComputeMatchModels(opts: {
  now?: Date;
  leagues?: readonly SupportedLeague[];
}): Promise<ComputeMatchModelsSummary> {
  const now = opts.now ?? new Date();
  const summary = emptySummary();
  const leagues = opts.leagues ?? (await getActiveLeagues());
  // Lidos UMA vez por run.
  const jevEnabled = await getEnableMatchModelJev();
  const jevMissingKey = jevEnabled && !hasTypeSafeKey();
  summary.jevEnabled = jevEnabled;
  summary.jevMissingKey = jevMissingKey;
  if (jevMissingKey) {
    console.warn(
      JSON.stringify({ scope: SCOPE, event: "jev_skipped_missing_key" }),
    );
  }
  const provider = getSportsDataProvider();
  const startedMs = Date.now();

  // Tabela só sob demanda (heurístico ou state do JEV) e uma vez por liga: com DC
  // fresco o run não gasta essa chamada. Falha → undefined (o λ cai no que der).
  const standingsMemo = new Map<
    SupportedLeague,
    Promise<NormalizedStanding | undefined>
  >();
  const standingsFor = (league: SupportedLeague) => {
    let p = standingsMemo.get(league);
    if (!p) {
      p = provider.getStandings(league).catch((err: unknown) => {
        logError("standings_failed", { league, message: errMessage(err) });
        return undefined;
      });
      standingsMemo.set(league, p);
    }
    return p;
  };

  const upcoming: DbMatch[] = [];
  for (const league of leagues) {
    try {
      const rows = await getMatchesInLeagueWindow({
        league,
        fromMs: now.getTime(),
        windowHours: MODEL_BASE_WINDOW_HOURS,
      });
      // A query não filtra status: só jogo agendado e ainda por começar.
      const eligible = rows.filter(
        (m) => m.status === "scheduled" && m.kickoffAt.getTime() > now.getTime(),
      );
      summary.leagues.push({ league, matches: eligible.length, error: false });
      upcoming.push(...eligible);
    } catch (err) {
      summary.errors++;
      summary.leagues.push({ league, matches: 0, error: true });
      logError("league_failed", { league, message: errMessage(err) });
    }
  }

  const latestByMatch = await getLatestMatchModelSnapshotsForMatches(
    upcoming.map((m) => m.id),
  );

  // Row nova só quando o fingerprint muda; senão o heartbeat de checked_at.
  const writeIfChanged = async (
    matchId: string,
    row: ReturnType<typeof buildMatchModelSnapshot>,
  ) => {
    const latest = latestByMatch.get(matchId);
    if (latest && latest.fingerprint === row.fingerprint) {
      await touchMatchModelSnapshot(latest.id, now);
      summary.unchanged++;
      return;
    }
    await insertMatchModelSnapshot(row);
    summary.inserted++;
  };

  const write = (item: JevQueueItem, jev: JudgmentRun | null) =>
    writeIfChanged(
      item.matchId,
      buildMatchModelSnapshot({
        matchId: item.matchId,
        scoreline: item.scoreline,
        neutral: item.neutral,
        jev,
      }),
    );

  // Base sem JEV (o λ acompanha o refit), a menos que a última row do jogo tenha JEV:
  // não rebaixa uma base com JEV pra uma sem por falta de prazo/dado/chave. Também não
  // faz heartbeat nela (o reuso do predict confia no checked_at).
  const writeBaseUnlessJev = async (item: JevQueueItem) => {
    const latest = latestByMatch.get(item.matchId);
    if (latest && latest.jevStatus !== "not_attempted") return;
    await write(item, null);
  };

  const queue: JevQueueItem[] = [];
  for (const match of upcoming) {
    summary.considered++;
    try {
      const neutral = isNeutralVenue(match);
      const args = {
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        neutral,
      };
      let scoreline = await getModelScoreline(
        { ...args, standing: undefined },
        now,
      );
      if (!scoreline || scoreline.source !== "dixon_coles") {
        scoreline = await getModelScoreline(
          { ...args, standing: await standingsFor(match.league) },
          now,
        );
      }
      if (!scoreline) {
        summary.noModel++;
        continue;
      }
      const item: JevQueueItem = {
        matchId: match.id,
        kickoffAt: match.kickoffAt,
        match,
        scoreline,
        neutral,
      };
      const inJevWindow =
        jevEnabled && match.kickoffAt.getTime() - now.getTime() <= JEV_WINDOW_MS;
      if (!inJevWindow) {
        // Fora da janela, ou flag OFF (pode rebaixar: é a intenção do kill-switch).
        await write(item, null);
      } else if (jevMissingKey) {
        summary.jev.skippedMissingKey++;
        await writeBaseUnlessJev(item);
      } else {
        queue.push(item);
      }
    } catch (err) {
      summary.errors++;
      logError("match_failed", { matchId: match.id, message: errMessage(err) });
    }
  }

  summary.jev.queued = queue.length;
  for (const item of orderJevQueue(queue, latestByMatch, now)) {
    try {
      if (Date.now() - startedMs > RUN_DEADLINE_MS) {
        summary.jev.skippedDeadline++;
        await writeBaseUnlessJev(item);
        continue;
      }
      let data: Awaited<ReturnType<typeof fetchMatchJudgmentData>>;
      try {
        data = await fetchMatchJudgmentData({
          match: item.match,
          provider,
          standings: await standingsFor(item.match.league),
        });
      } catch (err) {
        summary.jev.dataUnavailable++;
        logError("jev_data_unavailable", {
          matchId: item.matchId,
          message: errMessage(err),
        });
        await writeBaseUnlessJev(item);
        continue;
      }
      const resolved = await resolveModelBaseJudgments({
        matchId: item.matchId,
        provider,
        data,
      });
      if (!resolved) {
        // Erro inesperado na porta do JEV (já logado lá): conta como falha do JEV.
        summary.jev.failed++;
        await writeBaseUnlessJev(item);
        continue;
      }
      const { run } = resolved;
      if (run.reusedFromPredictionId || run.reusedFromModelSnapshotId) {
        summary.jev.reused++;
      }
      if (run.answers) summary.jev.applied++;
      else summary.jev.failed++;
      await write(item, run);
    } catch (err) {
      summary.errors++;
      logError("match_failed", { matchId: item.matchId, message: errMessage(err) });
    }
  }

  console.log(JSON.stringify({ scope: SCOPE, event: "run_complete", ...summary }));
  return summary;
}
