// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEWS_MIN_BUDGET_MS } from "@/lib/ai/deadline";

import type { NewsFetchOutcome, NewsMatchContext } from "../types";

// As duas fontes mockadas: o teste é da ORQUESTRAÇÃO (quem roda quando).
const getNewsViaTeamFeeds = vi.fn();
vi.mock("../ge-rss", () => ({
  getNewsViaTeamFeeds: (...args: unknown[]) => getNewsViaTeamFeeds(...args),
}));
const getNewsByMatchViaWebSearch = vi.fn();
vi.mock("../anthropic-web-search", () => ({
  getNewsByMatchViaWebSearch: (...args: unknown[]) =>
    getNewsByMatchViaWebSearch(...args),
}));

import { getNewsCombined } from "../combined";

const CTX: NewsMatchContext = {
  league: "brasileirao_a",
  homeTeam: "SE Palmeiras",
  awayTeam: "CR Flamengo",
  kickoffAt: "2026-11-21T19:30:00.000Z",
};
const AUDIT = { userId: "u-1", matchId: "m-1" };

const GE_ITEM = {
  title: "Escalação do Flamengo",
  url: "https://ge.globo.com/futebol/a",
  snippet: "Trecho",
  publishedAt: "2026-11-21T18:30:25.000Z",
  source: "ge" as const,
};
const WEB_OUTCOME: NewsFetchOutcome = {
  results: [
    { title: "Web", url: "https://lance.com.br/x", source: "web_search" },
  ],
  aiCall: { id: "news-call-1" },
  status: "found",
  via: "web_search",
};

beforeEach(() => {
  getNewsViaTeamFeeds.mockReset();
  getNewsByMatchViaWebSearch.mockReset();
  getNewsByMatchViaWebSearch.mockResolvedValue(WEB_OUTCOME);
});

describe("getNewsCombined — RSS do ge primeiro", () => {
  it("feed com notícia → found pelo ge, SEM web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({
      kind: "ok",
      results: [GE_ITEM],
      partial: false,
    });
    const out = await getNewsCombined(CTX, AUDIT);
    expect(out).toEqual({
      results: [GE_ITEM],
      aiCall: null,
      status: "found",
      via: "ge",
    });
    expect(getNewsByMatchViaWebSearch).not.toHaveBeenCalled();
  });

  it("feed respondeu sem nada do jogo → none pelo ge, SEM web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({
      kind: "ok",
      results: [],
      partial: false,
    });
    const out = await getNewsCombined(CTX, AUDIT);
    expect(out).toEqual({
      results: [],
      aiCall: null,
      status: "none",
      via: "ge",
    });
    expect(getNewsByMatchViaWebSearch).not.toHaveBeenCalled();
  });

  it("meia falha → partial, ainda sem web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({
      kind: "ok",
      results: [],
      partial: true,
    });
    const out = await getNewsCombined(CTX, AUDIT);
    expect(out).toEqual({
      results: [],
      aiCall: null,
      status: "none",
      via: "ge",
      partial: true,
    });
    expect(getNewsByMatchViaWebSearch).not.toHaveBeenCalled();
  });

  it("repassa o prazo e o matchId pros feeds", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({
      kind: "ok",
      results: [],
      partial: false,
    });
    await getNewsCombined(CTX, AUDIT, { deadlineAt: 123 });
    expect(getNewsViaTeamFeeds).toHaveBeenCalledWith(CTX, {
      deadlineAt: 123,
      matchId: "m-1",
    });
  });
});

describe("getNewsCombined — fallback pra web search", () => {
  it("todos os feeds falharam e o prazo cabe → web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({ kind: "all_failed" });
    const deadlineAt = Date.now() + NEWS_MIN_BUDGET_MS + 5_000;
    const out = await getNewsCombined(CTX, AUDIT, { deadlineAt });
    expect(out).toBe(WEB_OUTCOME);
    expect(getNewsByMatchViaWebSearch).toHaveBeenCalledWith(CTX, AUDIT, {
      deadlineAt,
    });
  });

  it("todos os feeds falharam e não sobra prazo → failed, sem web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({ kind: "all_failed" });
    const out = await getNewsCombined(CTX, AUDIT, {
      deadlineAt: Date.now() + 2_000,
    });
    expect(out).toEqual({
      results: [],
      aiCall: null,
      status: "failed",
      via: null,
    });
    expect(getNewsByMatchViaWebSearch).not.toHaveBeenCalled();
  });

  it("jogo de fora (nenhum time com feed) → web search", async () => {
    getNewsViaTeamFeeds.mockResolvedValue({ kind: "no_sources" });
    const ctx = {
      ...CTX,
      league: "premier_league",
      homeTeam: "Arsenal FC",
      awayTeam: "Chelsea FC",
    };
    const out = await getNewsCombined(ctx, AUDIT);
    expect(out).toBe(WEB_OUTCOME);
    expect(getNewsByMatchViaWebSearch).toHaveBeenCalledWith(ctx, AUDIT, {});
  });
});
