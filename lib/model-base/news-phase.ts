import { MATCH_NEWS_EXTRACT_VERSION } from "@/lib/ai/match-news/extract-cartridge";
import { extractNewsClaims } from "@/lib/ai/match-news/extract";
import { sanitizeNews } from "@/lib/ai/news-input";
import { canonicalHash } from "@/lib/ai/judgments/state-hash";
import {
  findMatchNewsBatch,
  getLatestUsableNewsBatch,
  insertMatchNewsBatch,
  listMatchNewsInWindow,
  markMatchNewsBatchRetry,
  touchMatchNewsBatch,
  upsertMatchNews,
  type NewMatchNewsItem,
} from "@/lib/db/queries/match-news";
import type { DbMatch } from "@/lib/db/queries/matches";
import { NEWS_WINDOW_MS } from "@/lib/match-news/apply";
import type {
  MatchNewsBatchItem,
  MatchNewsFeedSide,
  StoredNewsBatch,
} from "@/lib/match-news/types";
import { canonicalUrl, getNewsViaTeamFeeds } from "@/lib/providers/news/ge-rss";
import { resolveTeamSources } from "@/lib/providers/news/team-sources";
import type { NewsResult } from "@/lib/providers/news/types";

// Fase de notícias do cron da base (#672, PLAN-672 §3 + ajustes 2 e 6). Roda DENTRO do
// run do compute-match-models (nenhum cron novo), em paralelo com o laço de λ, só pros
// jogos na janela do JEV com time no mapa do ge. Por jogo: RSS do ge (nunca a web
// search: sem custo e sem usuário) → upsert dos itens → hash do conjunto → lote
// existente só ganha heartbeat; lote novo com itens → 1 Haiku (match_news_extract_v1).
// Nunca rejeita: cada jogo devolve o lote usável (o deste run ou, quando o feed ou a
// extração falham, o último usável) ou null.

export const NEWS_PHASE_BUDGET_MS = 45_000;
const MATCH_CONCURRENCY = 4;
const EXTRACT_CONCURRENCY = 3;
// Teto de uma extração (o adapter corta pelo que resta do prazo da fase).
const EXTRACT_BUDGET_MS = 20_000;
// Tentativas por lote que falha (estouro de prazo não conta).
export const NEWS_EXTRACT_MAX_ATTEMPTS = 2;
// Lote usável pra base: visto pelo cron nas últimas 12h (= MODEL_BASE_JEV_REUSE_WINDOW_MS).
export const NEWS_BATCH_USABLE_MS = 12 * 60 * 60 * 1000;
const PER_SIDE_CAP = 5;
const TOTAL_CAP = 10;
const TITLE_MAX = 300;
const SNIPPET_MAX = 280;

const SCOPE = "compute_match_models";

export type NewsPhaseSummary = {
  targets: number;
  feedsOk: number;
  feedsFailed: number;
  itemsNew: number;
  batchesNew: number;
  extracted: number;
  reusedBatches: number;
  extractFailed: number;
  skippedDeadline: number;
  empty: number;
  matchesWithEvidence: number;
  movedFactors: number;
};

export function emptyNewsSummary(): NewsPhaseSummary {
  return {
    targets: 0,
    feedsOk: 0,
    feedsFailed: 0,
    itemsNew: 0,
    batchesNew: 0,
    extracted: 0,
    reusedBatches: 0,
    extractFailed: 0,
    skippedDeadline: 0,
    empty: 0,
    matchesWithEvidence: 0,
    movedFactors: 0,
  };
}

export type NewsPhase = {
  // Lote usável por jogo-alvo. A promise nunca rejeita.
  byMatch: Map<string, Promise<StoredNewsBatch | null>>;
  // Fim da fase inteira (o run espera antes do run_complete e de soltar o lock).
  done: Promise<void>;
};

/** Jogos-alvo: agendados, antes do apito, a ≤ janela do JEV, com feed do ge em algum lado. */
export function newsTargets(
  matches: readonly DbMatch[],
  now: Date,
  windowMs: number,
): DbMatch[] {
  return matches.filter(
    (m) =>
      m.status === "scheduled" &&
      m.kickoffAt.getTime() > now.getTime() &&
      m.kickoffAt.getTime() - now.getTime() <= windowMs &&
      (resolveTeamSources(m.homeTeam) !== null || resolveTeamSources(m.awayTeam) !== null),
  );
}

/** sha256 do conjunto (url, título, trecho), sem depender da ordem. */
export function newsBatchHash(
  items: readonly { url: string; title: string; snippet: string | null }[],
): string {
  return canonicalHash(
    [...items]
      .map((i) => ({ url: i.url, title: i.title, snippet: i.snippet }))
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
  );
}

// Limitador de concorrência simples (sem dependência nova).
function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Item do feed → item guardável: só o que a extração pode ler (URL https, título sem
// linguagem de valor; o mesmo critério do saneamento do prompt), URL canônica.
function toStorable(
  r: NewsResult,
  side: MatchNewsFeedSide | null,
): NewMatchNewsItem | null {
  if (!r.publishedAt || !Number.isFinite(Date.parse(r.publishedAt))) return null;
  const url = canonicalUrl(r.url.trim());
  if (sanitizeNews([{ title: r.title, url }]).length === 0) return null;
  const title = r.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  const snippet = r.snippet ? r.snippet.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX) : "";
  return {
    url,
    title,
    snippet: snippet === "" ? null : snippet,
    publishedAt: new Date(r.publishedAt),
    feedSide: side,
  };
}

export function startNewsPhase(args: {
  matches: readonly DbMatch[];
  now: Date;
  startedMs: number;
  windowMs: number;
  summary: NewsPhaseSummary;
}): NewsPhase {
  const { now, summary } = args;
  const deadlineAt = args.startedMs + NEWS_PHASE_BUDGET_MS;
  const targets = newsTargets(args.matches, now, args.windowMs);
  summary.targets = targets.length;
  const perMatch = limiter(MATCH_CONCURRENCY);
  const perExtract = limiter(EXTRACT_CONCURRENCY);

  const fallback = (matchId: string) =>
    getLatestUsableNewsBatch(matchId, {
      since: new Date(now.getTime() - NEWS_BATCH_USABLE_MS),
      promptVersion: MATCH_NEWS_EXTRACT_VERSION,
    });

  const extract = (
    match: DbMatch,
    refItems: readonly MatchNewsBatchItem[],
    snippetByUrl: Map<string, string | null>,
  ) =>
    perExtract(() =>
      extractNewsClaims({
        matchId: match.id,
        teams: { home: match.homeTeam, away: match.awayTeam },
        kickoffAt: match.kickoffAt,
        items: refItems.map((b) => ({
          ref: b.ref,
          title: b.title,
          url: b.url,
          snippet: snippetByUrl.get(b.url) ?? null,
          publishedAt: b.publishedAt,
        })),
        deadlineAt: Math.min(deadlineAt, Date.now() + EXTRACT_BUDGET_MS),
      }),
    );

  const processMatch = async (match: DbMatch): Promise<StoredNewsBatch | null> => {
    const feeds = await getNewsViaTeamFeeds(
      {
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt.toISOString(),
      },
      { deadlineAt, matchId: match.id },
    );
    if (feeds.kind !== "ok") {
      // Feed fora: o lote anterior fica (e envelhece pelo checked_at).
      if (feeds.kind === "all_failed") summary.feedsFailed++;
      return fallback(match.id);
    }
    summary.feedsOk++;
    if (feeds.partial) summary.feedsFailed++;

    const items: NewMatchNewsItem[] = [];
    for (const r of feeds.results) {
      const s = toStorable(r, feeds.sideByUrl[canonicalUrl(r.url)] ?? null);
      if (s && !items.some((i) => i.url === s.url)) items.push(s);
    }
    // Feed de um lado caiu (partial): os itens desse lado vêm do que já guardamos na
    // janela, pra o lote não "esquecer" a notícia por um feed que expirou.
    if (feeds.failedSides.length > 0) {
      const anchorMs = Math.min(now.getTime(), match.kickoffAt.getTime());
      for (const side of feeds.failedSides) {
        const stored = await listMatchNewsInWindow(match.id, {
          from: new Date(anchorMs - NEWS_WINDOW_MS),
          to: new Date(anchorMs),
          feedSide: side,
        });
        let kept = 0;
        for (const row of stored) {
          if (kept >= PER_SIDE_CAP || items.length >= TOTAL_CAP) break;
          if (items.some((i) => i.url === row.url)) continue;
          items.push({
            url: row.url,
            title: row.title,
            snippet: row.snippet,
            publishedAt: row.publishedAt,
            feedSide: side,
          });
          kept++;
        }
      }
    }
    const capped = items.slice(0, TOTAL_CAP);

    const rows = await upsertMatchNews(match.id, capped, now);
    summary.itemsNew += rows.filter((r) => r.firstSeenAt.getTime() === now.getTime()).length;
    const idByUrl = new Map(rows.map((r) => [r.url, r.id]));
    const batchItems: MatchNewsBatchItem[] = capped.map((i, idx) => ({
      ref: `N${idx + 1}`,
      newsId: idByUrl.get(i.url) ?? "",
      url: i.url,
      title: i.title,
      publishedAt: i.publishedAt.toISOString(),
    }));
    const batchHash = newsBatchHash(capped);

    const existing = await findMatchNewsBatch(match.id, batchHash, MATCH_NEWS_EXTRACT_VERSION);
    if (existing && existing.status !== "failed") {
      await touchMatchNewsBatch(existing.id, now);
      summary.reusedBatches++;
      if (existing.status === "empty" && existing.unknownOpponent) return fallback(match.id);
      return { ...existing, checkedAt: now > existing.checkedAt ? now : existing.checkedAt };
    }
    if (existing && existing.attempts >= NEWS_EXTRACT_MAX_ATTEMPTS) {
      return fallback(match.id);
    }
    if (!existing && capped.length === 0) {
      summary.empty++;
      summary.batchesNew++;
      const inserted = await insertMatchNewsBatch({
        matchId: match.id,
        batchHash,
        promptVersion: MATCH_NEWS_EXTRACT_VERSION,
        items: [],
        status: "empty",
        claims: [],
        warnings: [],
        partial: feeds.partial,
        unknownOpponent: feeds.unknownOpponent,
        aiCallId: null,
        now,
      });
      return inserted && !inserted.unknownOpponent ? inserted : fallback(match.id);
    }

    // Nova tentativa usa os refs do lote gravado (mesmo conjunto, mesma ordem).
    const result = await extract(
      match,
      existing ? existing.items : batchItems,
      new Map(capped.map((i) => [i.url, i.snippet])),
    );
    if (!result.ok && result.kind === "deadline") {
      // Sem tempo: não grava failed nem gasta tentativa; o próximo run tenta.
      summary.skippedDeadline++;
      return fallback(match.id);
    }
    if (result.ok) summary.extracted++;
    else {
      summary.extractFailed++;
      console.error(
        JSON.stringify({
          scope: SCOPE,
          event: "news_extract_failed",
          matchId: match.id,
          message: result.message,
        }),
      );
    }
    const outcome = {
      status: result.ok ? ("ok" as const) : ("failed" as const),
      claims: result.ok ? result.claims : [],
      warnings: result.ok ? result.warnings : [],
      aiCallId: result.aiCallId,
    };
    const saved = existing
      ? await markMatchNewsBatchRetry(existing.id, { ...outcome, now })
      : await insertMatchNewsBatch({
          matchId: match.id,
          batchHash,
          promptVersion: MATCH_NEWS_EXTRACT_VERSION,
          items: batchItems,
          ...outcome,
          partial: feeds.partial,
          unknownOpponent: feeds.unknownOpponent,
          now,
        });
    if (!existing) summary.batchesNew++;
    return saved && saved.status === "ok" ? saved : fallback(match.id);
  };

  const byMatch = new Map<string, Promise<StoredNewsBatch | null>>();
  for (const match of targets) {
    byMatch.set(
      match.id,
      perMatch(() => processMatch(match)).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            scope: SCOPE,
            event: "news_phase_failed",
            matchId: match.id,
            message: errMessage(err),
          }),
        );
        return null;
      }),
    );
  }
  const done = Promise.allSettled([...byMatch.values()]).then(() => undefined);
  return { byMatch, done };
}

/** Espera o lote do jogo com teto duro (o laço do JEV nunca fica preso na fase). */
export async function awaitNewsBatch(
  phase: NewsPhase | null,
  matchId: string,
  timeoutMs: number,
): Promise<StoredNewsBatch | null> {
  const p = phase?.byMatch.get(matchId);
  if (!p) return null;
  if (timeoutMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
