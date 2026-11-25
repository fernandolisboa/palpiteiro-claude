import { JUDGMENTS_VERSION } from "@/lib/ai/judgments/questions";
import { resolveModelBaseJudgments, type JudgmentRun } from "@/lib/ai/predict";
import { hasTypeSafeKey } from "@/lib/ai/providers/typesafe/client";
import { MATCH_NEWS_EXTRACT_VERSION } from "@/lib/ai/match-news/extract-cartridge";
import {
  getEnableMatchModelJev,
  getEnableNewsFactors,
} from "@/lib/db/queries/ai-config";
import { getActiveLeagues } from "@/lib/db/queries/league-settings";
import {
  getLatestMatchModelSnapshotsForMatches,
  insertMatchModelSnapshot,
  touchMatchModelSnapshot,
} from "@/lib/db/queries/match-model-snapshots";
import { getLatestUsableNewsBatchesForMatches } from "@/lib/db/queries/match-news";
import { getMatchesInLeagueWindow, type DbMatch } from "@/lib/db/queries/matches";
import { applyNewsClaims, type AppliedNews } from "@/lib/match-news/apply";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { isNeutralVenue } from "@/lib/providers/sports-data/neutral-venue";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { getModelScoreline } from "@/lib/ratings/model-scoreline";
import { acquireKvLock, releaseKvLock } from "@/lib/sync/lock";
import { factsFromAnalysisData } from "@/lib/user-palpite/analysis-context";

import { buildMatchModelSnapshot } from "./build-snapshot";
import { fetchMatchJudgmentData } from "./judgment-data";
import {
  NEWS_BATCH_USABLE_MS,
  NEWS_PHASE_BUDGET_MS,
  awaitNewsBatch,
  emptyNewsSummary,
  startNewsPhase,
  type NewsPhase,
  type NewsPhaseSummary,
} from "./news-phase";
import type { MatchModelSnapshot } from "./types";

// Cron da base do modelo por jogo (#555, ADR 0052): pra cada jogo agendado das ligas
// ativas nos próximos 7 dias, λ (Dixon-Coles ou heurístico) → JEV a ≤48h (atrás do
// flag, fila priorizada e prazo) → row nova só quando o fingerprint muda. Sem The Odds
// API. Falha de um jogo ou liga não derruba o resto. Notícias (#672): a fase de
// notícias roda dentro deste run, em paralelo (news-phase.ts), e o lote conferido entra
// por MÁXIMO depois do JEV (lib/match-news/apply.ts); 1 Haiku só por lote novo.

export const MODEL_BASE_WINDOW_HOURS = 7 * 24;
export const JEV_WINDOW_MS = 48 * 60 * 60 * 1000;
// Base com JEV mais velha que isto volta pro começo da fila JEV.
export const JEV_STALE_MS = 6 * 60 * 60 * 1000;
// Prazo pra COMEÇAR um jogo da fila JEV. Pior caso por jogo ≈ 16 req a 8/min na
// API-Football (forma ×2, fixtures do dia, desfalques, escalação, escalações
// anteriores 2×2, próximos jogos ×2, artilheiros do #617 e, com a escalação
// publicada, XI de referência 2×2 do #619: ~120 s) + JEV (~15 s) ≈ 135 s ⇒
// 150 + 135 = 285 s < maxDuration 300.
export const RUN_DEADLINE_MS = 150_000;
export const COMPUTE_MATCH_MODELS_LOCK_KEY = "model-base:compute:lock";
// = maxDuration da rota: um run que morre no meio libera o lock pelo TTL.
const LOCK_TTL_MS = 300_000;
// Folga sobre o prazo da fase de notícias pra o laço do JEV esperar o lote do jogo.
const NEWS_AWAIT_SLACK_MS = 5_000;

const SCOPE = "compute_match_models";

export type ComputeMatchModelsSummary = {
  skipped?: "locked";
  jevEnabled: boolean;
  jevMissingKey: boolean;
  newsEnabled: boolean;
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
  // Fase de notícias (#672). Falha aqui não conta em `errors` (fail-open).
  news: NewsPhaseSummary;
};

function emptySummary(): ComputeMatchModelsSummary {
  return {
    jevEnabled: false,
    jevMissingKey: false,
    newsEnabled: false,
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
    news: emptyNewsSummary(),
  };
}

// O que a fila precisa de um lote de notícias. Row sem `usableAt` cai no `createdAt`.
type NewsBatchStamp = { id: string; createdAt: Date; usableAt: Date | null };

const batchUsableAt = (b: NewsBatchStamp) => b.usableAt ?? b.createdAt;

/**
 * Ordem da fila JEV (puro). Bucket 0: jogo sem base, base sem JEV (`not_attempted`),
 * JEV que falhou (`failed`, tenta de novo antes de uma base `applied` fresca), base
 * com respostas de outra versão das perguntas, com `checked_at` mais velho que
 * JEV_STALE_MS, ou com um lote de notícias usável que a base ainda não viu (#672: outro
 * lote que o de `judgments.news`, que ficou usável (`usableAt`, relógio do run; cai no
 * `createdAt` em row sem ele) depois do último `checked_at`. O run que aplica o lote
 * grava a base com `checked_at` ≥ `usableAt`, então um lote novo com a mesma evidência
 * só faz heartbeat e não volta pro bucket 0; uma nova tentativa que deu ok ou um lote que
 * ficou pronto depois do laço do JEV desistir de esperar volta); bucket 1: o resto.
 * Dentro do bucket, kickoff mais próximo primeiro. O que não cabe no prazo do run
 * entra no próximo.
 */
export function orderJevQueue<T extends { matchId: string; kickoffAt: Date }>(
  items: T[],
  latestByMatch: Map<string, MatchModelSnapshot>,
  now: Date,
  newsBatchByMatch: Map<string, NewsBatchStamp> = new Map(),
): T[] {
  const bucket = (item: T): number => {
    const latest = latestByMatch.get(item.matchId);
    if (!latest || latest.jevStatus !== "applied") return 0;
    // Respostas de outro conjunto de perguntas (bump de JUDGMENTS_VERSION) não servem
    // mais pra ninguém: refaz primeiro.
    if (latest.judgments?.versions.judgments !== JUDGMENTS_VERSION) return 0;
    const batch = newsBatchByMatch.get(item.matchId);
    if (
      batch &&
      batch.id !== latest.judgments?.news?.batchId &&
      batchUsableAt(batch).getTime() > latest.checkedAt.getTime()
    ) {
      return 0;
    }
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

const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

// Resultado memoizado da busca da tabela: `ok: false` = a chamada falhou;
// `standing: undefined` = o provider respondeu sem tabela.
type StandingsFetch =
  | { ok: true; standing: NormalizedStanding | undefined }
  | { ok: false };

const standingOrUndefined = (r: StandingsFetch) =>
  r.ok ? r.standing : undefined;

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
  const newsEnabled = await getEnableNewsFactors();
  summary.jevEnabled = jevEnabled;
  summary.jevMissingKey = jevMissingKey;
  summary.newsEnabled = newsEnabled;
  if (jevMissingKey) {
    console.warn(
      JSON.stringify({ scope: SCOPE, event: "jev_skipped_missing_key" }),
    );
  }
  const provider = getSportsDataProvider();
  const startedMs = Date.now();

  // Tabela só sob demanda (heurístico ou state do JEV) e uma vez por liga: com DC
  // fresco o run não gasta essa chamada. A falha da busca fica distinta do provider
  // devolver undefined: o λ cai no que der com os dois, mas o JEV não roda sobre uma
  // falha transitória (o state sem tabela nunca bateria com o do predict).
  const standingsMemo = new Map<SupportedLeague, Promise<StandingsFetch>>();
  const standingsFor = (league: SupportedLeague) => {
    let p = standingsMemo.get(league);
    if (!p) {
      p = provider.getStandings(league).then(
        (standing): StandingsFetch => ({ ok: true, standing }),
        (err: unknown): StandingsFetch => {
          logError("standings_failed", { league, message: errMessage(err) });
          return { ok: false };
        },
      );
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

  // Fase de notícias (#672) disparada JUNTO do laço de λ: nunca rejeita, e o run espera
  // o fim dela antes do run_complete e de soltar o lock (finally abaixo).
  const newsPhase: NewsPhase | null = newsEnabled
    ? startNewsPhase({
        matches: upcoming,
        now,
        startedMs,
        windowMs: JEV_WINDOW_MS,
        summary: summary.news,
        // A notícia só entra na base com o JEV tentado: sem ele, nada de Haiku.
        extract: jevEnabled && !jevMissingKey,
      })
    : null;
  try {
    await runModelLoops();
  } finally {
    if (newsPhase) await newsPhase.done;
  }

  console.log(JSON.stringify({ scope: SCOPE, event: "run_complete", ...summary }));
  return summary;

  // Os laços de λ e do JEV (corpo de antes do #672), dentro do try da fase de notícias.
  async function runModelLoops(): Promise<void> {
    // Row nova só quando o fingerprint muda; senão o heartbeat de checked_at.
    // `checkedAt` (só quando a base viu um lote de notícias): ≥ o `usableAt` do lote, pra
    // a fila do próximo run saber que este lote já entrou (orderJevQueue).
    const writeIfChanged = async (
      matchId: string,
      row: ReturnType<typeof buildMatchModelSnapshot>,
      checkedAt?: Date,
    ) => {
      const latest = latestByMatch.get(matchId);
      if (latest && latest.fingerprint === row.fingerprint) {
        await touchMatchModelSnapshot(latest.id, checkedAt ?? now);
        summary.unchanged++;
        return;
      }
      await insertMatchModelSnapshot(checkedAt ? { ...row, checkedAt } : row);
      summary.inserted++;
    };

    const write = (
      item: JevQueueItem,
      jev: JudgmentRun | null,
      news: AppliedNews | null = null,
      checkedAt?: Date,
    ) =>
      writeIfChanged(
        item.matchId,
        buildMatchModelSnapshot({
          matchId: item.matchId,
          scoreline: item.scoreline,
          neutral: item.neutral,
          jev,
          news,
        }),
        checkedAt,
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
            {
              ...args,
              standing: standingOrUndefined(await standingsFor(match.league)),
            },
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
    // Leitura barata (uma query) dos lotes usáveis pra ordenar a fila (#672, ajuste 1).
    const newsBatchByMatch =
      newsEnabled && queue.length > 0
        ? await getLatestUsableNewsBatchesForMatches(
            queue.map((q) => q.matchId),
            {
              since: new Date(now.getTime() - NEWS_BATCH_USABLE_MS),
              promptVersion: MATCH_NEWS_EXTRACT_VERSION,
            },
          ).catch((err: unknown) => {
            logError("news_batches_read_failed", { message: errMessage(err) });
            return new Map<string, NewsBatchStamp>();
          })
        : new Map<string, NewsBatchStamp>();
    for (const item of orderJevQueue(queue, latestByMatch, now, newsBatchByMatch)) {
      try {
        if (Date.now() - startedMs > RUN_DEADLINE_MS) {
          summary.jev.skippedDeadline++;
          await writeBaseUnlessJev(item);
          continue;
        }
        // Tabela que falhou = dado indisponível: sem JEV (um state sem tabela grudaria
        // numa row `applied` que o predict nunca reusaria).
        const standings = await standingsFor(item.match.league);
        if (!standings.ok) {
          summary.jev.dataUnavailable++;
          logError("jev_data_unavailable", {
            matchId: item.matchId,
            message: "standings_failed",
          });
          await writeBaseUnlessJev(item);
          continue;
        }
        let data: Awaited<ReturnType<typeof fetchMatchJudgmentData>>;
        try {
          data = await fetchMatchJudgmentData({
            match: item.match,
            provider,
            standings: standings.standing,
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
        const { input, run } = resolved;
        if (run.reusedFromPredictionId || run.reusedFromModelSnapshotId) {
          summary.jev.reused++;
        }
        if (run.answers) summary.jev.applied++;
        else summary.jev.failed++;
        // Notícias (#672): o lote do jogo (em geral já pronto: o laço gasta ~55 s de
        // API-Football por jogo), conferido com os fatos que ESTE laço buscou. Lote já
        // pronto volta mesmo com o teto esgotado; só um pendente depois dele vira null.
        const batch = await awaitNewsBatch(
          newsPhase,
          item.matchId,
          startedMs + NEWS_PHASE_BUDGET_MS + NEWS_AWAIT_SLACK_MS - Date.now(),
        );
        let news: AppliedNews | null = null;
        if (batch?.status === "ok") {
          try {
            news = applyNewsClaims({
              batch,
              facts: factsFromAnalysisData({
                absences: input.providerAbsences,
                homeForm: data.homeForm,
                awayForm: data.awayForm,
                standings: standings.standing,
              }),
              lineup: input.lineup,
              teams: { home: item.match.homeTeam, away: item.match.awayTeam },
              league: item.match.league,
              kickoffAt: item.match.kickoffAt,
              now,
              jev: run.answers,
            });
            if (news.moved.length > 0) {
              summary.news.matchesWithEvidence++;
              summary.news.movedFactors += news.moved.length;
            }
          } catch (err) {
            logError("news_apply_failed", { matchId: item.matchId, message: errMessage(err) });
          }
        }
        // A base viu este lote (aplicado ou não): checked_at ≥ quando ele ficou usável.
        const seenAt = batch ? maxDate(now, batchUsableAt(batch)) : undefined;
        await write(item, run, news, seenAt);
      } catch (err) {
        summary.errors++;
        logError("match_failed", { matchId: item.matchId, message: errMessage(err) });
      }
    }
  }
}
