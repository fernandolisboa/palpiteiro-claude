import { remainingMs } from "@/lib/ai/deadline";

import {
  parseRssItems,
  looksLikeRssFeed,
  makeSnippet,
  flattenWhitespace,
  type RssItem,
} from "./rss-parse";
import {
  foldText,
  isKnownTeam,
  matchupSlugPattern,
  mentionTermsFor,
  resolveTeamSources,
} from "./team-sources";
import type { NewsMatchContext, NewsResult } from "./types";

// Fonte primária de notícias pra time brasileiro (ADR 0032, adendo #670): o RSS do ge
// por time. Sem LLM e sem custo: um GET por time, em paralelo, com timeout curto e
// fail-open (qualquer falha vira "esse feed falhou", nunca exceção). Único lugar que
// faz fetch do ge (fronteira de lib/providers).

const GE_FEED_BASE = "https://ge.globo.com/rss/ge/futebol/times/";
// User-Agent explícito, genérico (sem dado do usuário).
const USER_AGENT = "Mozilla/5.0 (compatible; PalpiteiroNews/1.0)";

const FEED_TIMEOUT_MS = 4_000;
// O fetch termina 1s antes do prazo da busca.
const FEED_DEADLINE_MARGIN_MS = 1_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;

// Janela: 72h antes da âncora (min(agora, apito)). Nada pós-apito entra.
const WINDOW_MS = 72 * 3_600_000;
// Feed cujo item mais novo tem mais de 7 dias está parado: conta como falha.
const STALE_FEED_MS = 7 * 24 * 3_600_000;

const PER_TEAM_CAP = 5;
const TOTAL_CAP = 10;

// Só matéria de futebol masculino do ge: /futebol/ ou /<uf>/futebol/, menos blog,
// fantasy (gato-mestre/cartola), internacional e feminino.
const GE_ORIGIN = "https://ge.globo.com";
const GE_PATH_ALLOW = /^https:\/\/ge\.globo\.com\/(?:[a-z]{2}\/)?futebol\//;
const GE_PATH_DENY =
  /\/(?:blogs|gato-mestre|cartola|futebol-internacional|futebol-feminino|basquete|volei)\//;

// Notícia de escalação/desfalque sobe antes da ordem por data (texto dobrado). Técnico
// só conta com troca (novo/demitido/demissão): "técnico" sozinho está em meia matéria
// do ge. "fora de casa" é mando, não desfalque.
const PRIORITY_TERMS =
  /desfalc|\bles(?:ao|oes)\b|lesionad|suspens|escala|pendurad|amarelo|vetad|duvida|\bfora d[oe]\b(?!\s+casa)|poupa|\bdemit|\bdemiss|\bnovo\s+(?:tecnico|treinador)/;

export function geFeedUrl(slug: string): string {
  return `${GE_FEED_BASE}${slug}/`;
}

type FeedResult =
  | { ok: true; items: RssItem[] }
  | { ok: false; reason: string };

const cache = new Map<string, { at: number; items: RssItem[] }>();

/** Test seam: limpa o cache em processo dos feeds. Produção NÃO chama. */
export function __clearFeedCacheForTesting(): void {
  cache.clear();
}

// Lê o corpo com teto de bytes: corta (e falha) acima de MAX_FEED_BYTES em vez de
// carregar um corpo gigante na memória.
async function readCappedBody(res: Response): Promise<string | null> {
  if (!res.body) {
    const text = await res.text();
    return text.length > MAX_FEED_BYTES ? null : text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_FEED_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function feedTimeoutMs(deadlineAt: number | undefined): number {
  if (deadlineAt === undefined) return FEED_TIMEOUT_MS;
  return Math.min(
    FEED_TIMEOUT_MS,
    remainingMs(deadlineAt) - FEED_DEADLINE_MARGIN_MS
  );
}

/**
 * Baixa e parseia um feed. Cache em processo de 10 min, só de sucesso (itens
 * parseados, não o XML). 200 que não é feed, feed sem item e feed parado (item mais
 * novo com mais de 7 dias) contam como falha. Nunca lança.
 */
export async function fetchFeed(
  url: string,
  deadlineAt: number | undefined
): Promise<FeedResult> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_TTL_MS) return { ok: true, items: hit.items };

  const timeoutMs = feedTimeoutMs(deadlineAt);
  if (timeoutMs <= 0) return { ok: false, reason: "no_time" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
      return { ok: false, reason: "too_large" };
    }
    const xml = await readCappedBody(res);
    if (xml === null) return { ok: false, reason: "too_large" };
    if (!looksLikeRssFeed(xml)) return { ok: false, reason: "not_a_feed" };
    const items = parseRssItems(xml);
    if (items.length === 0) return { ok: false, reason: "no_items" };
    const newest = Math.max(
      ...items.map((i) => i.pubDate?.getTime() ?? -Infinity)
    );
    if (!Number.isFinite(newest) || Date.now() - newest > STALE_FEED_MS) {
      return { ok: false, reason: "stale_feed" };
    }
    cache.set(url, { at: Date.now(), items });
    return { ok: true, items };
  } catch (err) {
    return {
      ok: false,
      reason: controller.signal.aborted
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// URL sem query/fragmento: o mesmo artigo com ?utm=… é o mesmo artigo.
export function canonicalUrl(url: string): string {
  return url.replace(/[?#].*$/, "");
}

type Candidate = NewsResult & { priority: boolean; publishedMs: number };

function rank(a: Candidate, b: Candidate): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  return b.publishedMs - a.publishedMs;
}

/**
 * Itens de UM feed que servem pro jogo: publicados na janela (anchor − 72h ≤ pubDate ≤
 * anchor), matéria de futebol do ge (allowlist de caminho) e que citam o ADVERSÁRIO no
 * título ou na linha fina (o corpo gera ruído) ou trazem o confronto no link
 * (`palmeiras-x-flamengo-…`, com `team` informado). Ordenados (escalação/desfalque
 * antes, depois o mais novo), sem duplicata e SEM corte.
 */
export function matchFeedItems(
  items: readonly RssItem[],
  args: { anchorMs: number; opponent: string; team?: string }
): Candidate[] {
  const terms = mentionTermsFor(args.opponent);
  const matchup =
    args.team === undefined
      ? null
      : matchupSlugPattern(args.team, args.opponent);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const published = item.pubDate?.getTime();
    if (published === undefined) continue;
    if (published > args.anchorMs || published < args.anchorMs - WINDOW_MS)
      continue;
    const link = item.link.trim();
    if (!GE_PATH_ALLOW.test(link) || GE_PATH_DENY.test(link)) continue;
    const head = foldText(`${item.title} ${item.subtitle ?? ""}`);
    const key = canonicalUrl(link);
    const mentions =
      terms.some((re) => re.test(head)) ||
      (matchup !== null && matchup.test(foldText(key.slice(GE_ORIGIN.length))));
    if (!mentions) continue;
    // Duplicata no mesmo feed não come vaga do corte por time.
    if (seen.has(key)) continue;
    seen.add(key);
    const snippet = makeSnippet(item);
    out.push({
      title: flattenWhitespace(item.title),
      url: link,
      ...(snippet ? { snippet } : {}),
      publishedAt: new Date(published).toISOString(),
      source: "ge",
      priority: PRIORITY_TERMS.test(head),
      publishedMs: published,
    });
  }
  return out.sort(rank);
}

/** `matchFeedItems` cortado em PER_TEAM_CAP (um feed sozinho). */
export function filterFeedItems(
  items: readonly RssItem[],
  args: { anchorMs: number; opponent: string; team?: string }
): Candidate[] {
  return matchFeedItems(items, args).slice(0, PER_TEAM_CAP);
}

export type TeamFeedsOutcome =
  // Nenhum dos dois times tem feed mapeado (ligas de fora).
  | { kind: "no_sources" }
  // Todo feed tentado falhou.
  | { kind: "all_failed" }
  // Algum feed respondeu; `partial` = outro feed tentado falhou. `unknownOpponent` = o
  // adversário de algum feed lido está fora da tabela (estrangeiro da Libertadores):
  // a menção a ele é casada por token, então "nada no feed" não prova "nada novo".
  | {
      kind: "ok";
      results: NewsResult[];
      partial: boolean;
      unknownOpponent: boolean;
      // De qual feed veio cada resultado (URL canônica → lado) e os lados cujo feed
      // falhou (#672: o cron completa o lote com os itens guardados desse lado).
      sideByUrl: Record<string, "home" | "away">;
      failedSides: ("home" | "away")[];
    };

/**
 * Notícias do jogo pelos feeds do ge dos dois times, em paralelo (allSettled: um feed
 * lento ou quebrado não derruba o outro). Junta, tira duplicata por URL (sem
 * query/fragmento), ordena e corta em TOTAL_CAP. Loga `news_feed_failed` por feed.
 */
export async function getNewsViaTeamFeeds(
  ctx: NewsMatchContext,
  options: { deadlineAt?: number; matchId?: string } = {}
): Promise<TeamFeedsOutcome> {
  const kickoffMs = Date.parse(ctx.kickoffAt);
  const anchorMs = Number.isFinite(kickoffMs)
    ? Math.min(Date.now(), kickoffMs)
    : Date.now();
  const sides = [
    { team: ctx.homeTeam, opponent: ctx.awayTeam, side: "home" as const },
    { team: ctx.awayTeam, opponent: ctx.homeTeam, side: "away" as const },
  ].flatMap((side) => {
    const source = resolveTeamSources(side.team);
    return source ? [{ ...side, url: geFeedUrl(source.geSlug) }] : [];
  });
  if (sides.length === 0) return { kind: "no_sources" };

  const settled = await Promise.allSettled(
    sides.map((side) => fetchFeed(side.url, options.deadlineAt))
  );
  const perFeed: { side: "home" | "away"; list: Candidate[] }[] = [];
  const failedSides: ("home" | "away")[] = [];
  let okCount = 0;
  let unknownOpponent = false;
  settled.forEach((s, i) => {
    const feed: FeedResult =
      s.status === "fulfilled"
        ? s.value
        : {
            ok: false,
            reason:
              s.reason instanceof Error ? s.reason.message : String(s.reason),
          };
    if (!feed.ok) {
      console.error(
        JSON.stringify({
          scope: "getNewsViaTeamFeeds",
          matchId: options.matchId,
          error: "news_feed_failed",
          url: sides[i].url,
          reason: feed.reason,
        })
      );
      failedSides.push(sides[i].side);
      return;
    }
    okCount += 1;
    if (!isKnownTeam(sides[i].opponent)) unknownOpponent = true;
    perFeed.push({
      side: sides[i].side,
      list: matchFeedItems(feed.items, {
        anchorMs,
        opponent: sides[i].opponent,
        team: sides[i].team,
      }),
    });
  });
  if (okCount === 0) return { kind: "all_failed" };

  // Tira a duplicata entre feeds ANTES do corte por time: a matéria que já veio pelo
  // feed de um time não come vaga do outro.
  const taken = new Set<string>();
  const candidates: Candidate[] = [];
  const sideByUrl: Record<string, "home" | "away"> = {};
  for (const { side, list } of perFeed) {
    let kept = 0;
    for (const c of list) {
      if (kept >= PER_TEAM_CAP) break;
      const key = canonicalUrl(c.url);
      if (taken.has(key)) continue;
      taken.add(key);
      sideByUrl[key] = side;
      candidates.push(c);
      kept += 1;
    }
  }
  const results = candidates
    .sort(rank)
    .slice(0, TOTAL_CAP)
    .map(({ priority: _p, publishedMs: _m, ...result }) => result);
  const kept = new Set(results.map((r) => canonicalUrl(r.url)));
  return {
    kind: "ok",
    results,
    partial: okCount < sides.length,
    unknownOpponent,
    sideByUrl: Object.fromEntries(
      Object.entries(sideByUrl).filter(([url]) => kept.has(url))
    ),
    failedSides,
  };
}
