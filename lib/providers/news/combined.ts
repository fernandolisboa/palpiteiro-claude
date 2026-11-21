import { NEWS_MIN_BUDGET_MS, remainingMs } from "@/lib/ai/deadline";

import { getNewsByMatchViaWebSearch } from "./anthropic-web-search";
import { getNewsViaTeamFeeds } from "./ge-rss";
import type {
  NewsAuditContext,
  NewsFetchOptions,
  NewsFetchOutcome,
  NewsMatchContext,
} from "./types";

// Orquestra as fontes de notícia (ADR 0032, adendo #670):
//   1. RSS do ge dos dois times (grátis, ~1s). Algum feed respondeu → found/none pelo
//      ge, SEM web search: o ge já está no allowed_domains e a busca acharia o mesmo,
//      pagando a busca e 10–15s. Um feed ok e o outro quebrado = meia falha (partial),
//      ainda sem web search.
//   2. Todo feed falhou → web search, se o prazo ainda couber; senão failed.
//   3. Nenhum time com feed (ligas de fora) → web search.
export async function getNewsCombined(
  ctx: NewsMatchContext,
  audit: NewsAuditContext,
  options: NewsFetchOptions = {}
): Promise<NewsFetchOutcome> {
  const feeds = await getNewsViaTeamFeeds(ctx, {
    deadlineAt: options.deadlineAt,
    matchId: audit.matchId,
  });

  if (feeds.kind === "ok") {
    return {
      results: feeds.results,
      aiCall: null,
      status: feeds.results.length > 0 ? "found" : "none",
      via: "ge",
      ...(feeds.partial ? { partial: true } : {}),
    };
  }

  if (feeds.kind === "all_failed") {
    const fits =
      options.deadlineAt === undefined ||
      remainingMs(options.deadlineAt) >= NEWS_MIN_BUDGET_MS;
    if (!fits)
      return { results: [], aiCall: null, status: "failed", via: null };
  }

  return getNewsByMatchViaWebSearch(ctx, audit, options);
}
