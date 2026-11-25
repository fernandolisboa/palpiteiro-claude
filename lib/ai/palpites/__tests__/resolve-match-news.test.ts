import { beforeEach, describe, expect, it, vi } from "vitest";

// De onde vêm as notícias da análise (#672, C2; PLAN-672 §7 + ajustes 5, 10 e 12): o lote
// guardado usável e fresco ou o caminho ao vivo de hoje (#670).

vi.mock("@/lib/db", () => ({ db: {} }));
const loadStoredMatchNews = vi.fn();
vi.mock("@/lib/match-news/stored", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/match-news/stored")>()),
  loadStoredMatchNews: (...a: unknown[]) => loadStoredMatchNews(...a),
}));
const getNewsByMatch = vi.fn();
vi.mock("@/lib/providers/news", () => ({
  getNewsProvider: vi.fn(() => ({ getNewsByMatch })),
}));

import type { ProgressEvent } from "@/lib/ai/progress/protocol";
import { progressTrace, withRunProgress } from "@/lib/ai/progress/run-progress";
import { STEP_NOTES } from "@/lib/ai/progress/steps";
import type { StoredMatchNews } from "@/lib/match-news/stored";
import type { MatchNewsBatchItem } from "@/lib/match-news/types";

import { noteStoredNewsStep, resolveMatchNews, storedNewsOutcome } from "../index";

const HOUR = 3_600_000;
const NOW = new Date();
const MATCH = {
  id: "m1",
  league: "brasileirao_a",
  homeTeam: "SE Palmeiras",
  awayTeam: "CR Flamengo",
  kickoffAt: new Date(NOW.getTime() + 8 * HOUR),
};
const AUDIT = { userId: "u1", matchId: "m1" };

const item = (n: number, hoursAgo: number): MatchNewsBatchItem => ({
  ref: `N${n}`,
  newsId: `id-${n}`,
  url: `https://ge.globo.com/futebol/noticia/${n}.ghtml`,
  title: `Matéria ${n}`,
  publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
});

function stored(over: Partial<StoredMatchNews["batch"]> = {}): StoredMatchNews {
  return {
    batch: {
      id: "b1",
      matchId: "m1",
      batchHash: "h",
      promptVersion: "match_news_extract_v1",
      items: [item(1, 2), item(2, 4), item(3, 100)],
      status: "ok",
      claims: [],
      warnings: [],
      attempts: 1,
      partial: false,
      unknownOpponent: false,
      aiCallId: null,
      createdAt: new Date(NOW.getTime() - HOUR),
      checkedAt: new Date(NOW.getTime() - HOUR),
      usableAt: new Date(NOW.getTime() - HOUR),
      ...over,
    },
    results: [
      {
        title: "Matéria 1",
        url: "https://ge.globo.com/futebol/noticia/1.ghtml",
        publishedAt: item(1, 2).publishedAt,
        source: "ge",
      },
    ],
    factorsEnabled: true,
  };
}

const LIVE = { results: [], aiCall: null, status: "none" as const, via: "ge" as const };

function collect() {
  const events: ProgressEvent[] = [];
  return { events, send: (e: ProgressEvent) => events.push(e) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getNewsByMatch.mockResolvedValue(LIVE);
});

describe("resolveMatchNews", () => {
  it("lote guardado: o desfecho é o lote (via ge), sem busca ao vivo e sem passo", async () => {
    loadStoredMatchNews.mockResolvedValue({ stored: stored(), notChecked: false });
    const c = collect();
    const r = await withRunProgress(c.send, () =>
      resolveMatchNews(MATCH, AUDIT, undefined, { startLive: true }),
    );
    expect(r.stored?.batch.id).toBe("b1");
    expect(await r.outcome).toEqual({
      results: stored().results,
      aiCall: null,
      status: "found",
      via: "ge",
    });
    expect(getNewsByMatch).not.toHaveBeenCalled();
    expect(c.events).toEqual([]);
    expect(loadStoredMatchNews).toHaveBeenCalledWith({ id: "m1", kickoffAt: MATCH.kickoffAt });
  });

  it("sem lote usável (inclusive empty com adversário estrangeiro): o caminho ao vivo", async () => {
    loadStoredMatchNews.mockResolvedValue({ stored: null, notChecked: false });
    const r = await resolveMatchNews(MATCH, AUDIT, undefined, { startLive: true });
    expect(r.stored).toBeNull();
    expect(await r.outcome).toEqual(LIVE);
    expect(getNewsByMatch).toHaveBeenCalledTimes(1);
  });

  it("serial (startLive false) sem lote: nada parte agora; a síntese busca no fim", async () => {
    loadStoredMatchNews.mockResolvedValue({ stored: null, notChecked: false });
    const r = await resolveMatchNews(MATCH, AUDIT, undefined, { startLive: false });
    expect(r).toEqual({ stored: null, outcome: undefined });
    expect(getNewsByMatch).not.toHaveBeenCalled();
  });

  it("o cron viu lote que a extração não leu: a busca ao vivo avisa que não foi conferido", async () => {
    loadStoredMatchNews.mockResolvedValue({ stored: null, notChecked: true });
    const c = collect();
    await withRunProgress(c.send, async () => {
      const r = await resolveMatchNews(MATCH, AUDIT, undefined, { startLive: true });
      await r.outcome;
    });
    const last = c.events.filter((e) => e.id === "news").at(-1);
    expect(last?.detail).toContain(STEP_NOTES.newsNotChecked);
  });

  it("lote empty: desfecho 'none' (nada novo no ge)", () => {
    const s = { ...stored({ status: "empty", items: [] }), results: [] };
    expect(storedNewsOutcome(s)).toMatchObject({ status: "none", via: "ge", results: [] });
    expect(storedNewsOutcome({ ...stored({ partial: true }) })).toMatchObject({ partial: true });
  });
});

describe("noteStoredNewsStep (só texto, sem o predict code_jev)", () => {
  it("'N notícias do ge lidas às HH' com os itens da janela, sem a parte do fator", async () => {
    const c = collect();
    const trace = await withRunProgress(c.send, async () => {
      noteStoredNewsStep(stored(), MATCH, NOW);
      return progressTrace();
    });
    const news = trace.filter((s) => s.id === "news");
    expect(news).toHaveLength(1);
    expect(news[0].status).toBe("done");
    expect(news[0].label).toMatch(/^2 notícias do ge lidas (às|ontem às) \d\dh\d\d$/);
  });

  it("lote empty: a frase do ge vazio, com quando foi conferido", async () => {
    const c = collect();
    const trace = await withRunProgress(c.send, async () => {
      noteStoredNewsStep(stored({ status: "empty", items: [] }), MATCH, NOW);
      return progressTrace();
    });
    expect(trace[0].label).toBe(STEP_NOTES.newsNoneGe);
    expect(trace[0].detail?.[0]).toMatch(/^Notícias do ge conferidas pela última vez /);
  });
});
