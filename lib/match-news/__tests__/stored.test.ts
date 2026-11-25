import { beforeEach, describe, expect, it, vi } from "vitest";

// O lote guardado lido pela análise (#672, C2; PLAN-672 §7 + ajustes 1, 10 e 12).

const getEnableNewsFactors = vi.fn();
const getEnableMatchModelJev = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableNewsFactors: () => getEnableNewsFactors(),
  getEnableMatchModelJev: () => getEnableMatchModelJev(),
}));
const getNewsBatchForAnalysis = vi.fn();
const getMatchNewsByIds = vi.fn();
vi.mock("@/lib/db/queries/match-news", () => ({
  getNewsBatchForAnalysis: (...a: unknown[]) => getNewsBatchForAnalysis(...a),
  getMatchNewsByIds: (...a: unknown[]) => getMatchNewsByIds(...a),
}));
const hasTypeSafeKey = vi.fn();
vi.mock("@/lib/ai/providers/typesafe/client", () => ({
  hasTypeSafeKey: () => hasTypeSafeKey(),
}));

import { MATCH_NEWS_EXTRACT_VERSION } from "@/lib/ai/match-news/extract-cartridge";

import { isUnsafeNewsTitle, newsFactorPhrase, splitQuestionId } from "../labels";
import {
  STORED_NEWS_FRESH_MS,
  batchItemsInWindow,
  loadStoredMatchNews,
  resetStoredMatchNewsMemo,
} from "../stored";
import type { MatchNewsBatchItem, StoredNewsBatch } from "../types";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-21T13:00:00Z");
const KICKOFF = new Date("2026-11-21T21:30:00Z");
const MATCH = { id: "m1", kickoffAt: KICKOFF };

const item = (n: number, hoursAgo: number, title = `Matéria ${n}`): MatchNewsBatchItem => ({
  ref: `N${n}`,
  newsId: `id-${n}`,
  url: `https://ge.globo.com/futebol/noticia/${n}.ghtml`,
  title,
  publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
});

function batch(over: Partial<StoredNewsBatch> = {}): StoredNewsBatch {
  return {
    id: "b1",
    matchId: "m1",
    batchHash: "h",
    promptVersion: MATCH_NEWS_EXTRACT_VERSION,
    items: [
      item(1, 2),
      item(2, 5, "Palmeiras x Flamengo no Brasileirão Betano: onde assistir"),
      item(3, 6, "Flamengo tem as melhores odds da rodada"),
      item(4, 80),
    ],
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
  };
}

beforeEach(() => {
  resetStoredMatchNewsMemo();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getEnableNewsFactors.mockResolvedValue(true);
  getEnableMatchModelJev.mockResolvedValue(true);
  hasTypeSafeKey.mockReturnValue(true);
  getNewsBatchForAnalysis.mockResolvedValue({ usable: batch(), failedOnly: false });
  getMatchNewsByIds.mockResolvedValue([
    { id: "id-1", snippet: "Trecho 1" },
    { id: "id-2", snippet: "Trecho 2" },
  ]);
});

describe("loadStoredMatchNews", () => {
  it("lote usável: itens da janela, sem título de casa de aposta nem de valor, com o trecho", async () => {
    const got = await loadStoredMatchNews(MATCH, NOW);
    expect(got.notChecked).toBe(false);
    expect(got.stored?.batch.id).toBe("b1");
    expect(got.stored?.factorsEnabled).toBe(true);
    expect(got.stored?.results).toEqual([
      {
        title: "Matéria 1",
        url: "https://ge.globo.com/futebol/noticia/1.ghtml",
        snippet: "Trecho 1",
        publishedAt: item(1, 2).publishedAt,
        source: "ge",
      },
    ]);
    // A leitura usa a janela de 12h e a versão corrente da extração.
    expect(getNewsBatchForAnalysis).toHaveBeenCalledWith("m1", {
      since: new Date(NOW.getTime() - STORED_NEWS_FRESH_MS),
      promptVersion: MATCH_NEWS_EXTRACT_VERSION,
    });
    // O item fora da janela (80h) nem busca o trecho.
    expect(getMatchNewsByIds).toHaveBeenCalledWith(["id-1", "id-2", "id-3"]);
  });

  it("flag enable_news_factors desligada → nada, sem ler o banco", async () => {
    getEnableNewsFactors.mockResolvedValue(false);
    expect(await loadStoredMatchNews(MATCH, NOW)).toEqual({ stored: null, notChecked: false });
    expect(getNewsBatchForAnalysis).not.toHaveBeenCalled();
  });

  it("sem lote usável e só failed → 'não conferido'", async () => {
    getNewsBatchForAnalysis.mockResolvedValue({ usable: null, failedOnly: true });
    expect(await loadStoredMatchNews(MATCH, NOW)).toEqual({ stored: null, notChecked: true });
  });

  it("fator só nas condições da base: JEV desligado ou sem chave → só texto", async () => {
    getEnableMatchModelJev.mockResolvedValue(false);
    expect((await loadStoredMatchNews(MATCH, NOW)).stored?.factorsEnabled).toBe(false);
    resetStoredMatchNewsMemo();
    getEnableMatchModelJev.mockResolvedValue(true);
    hasTypeSafeKey.mockReturnValue(false);
    expect((await loadStoredMatchNews(MATCH, NOW)).stored?.factorsEnabled).toBe(false);
  });

  it("memo por jogo: o run inteiro lê o lote uma vez", async () => {
    await Promise.all([loadStoredMatchNews(MATCH, NOW), loadStoredMatchNews(MATCH, NOW)]);
    await loadStoredMatchNews(MATCH, NOW);
    expect(getNewsBatchForAnalysis).toHaveBeenCalledTimes(1);
    await loadStoredMatchNews({ id: "m2", kickoffAt: KICKOFF }, NOW);
    expect(getNewsBatchForAnalysis).toHaveBeenCalledTimes(2);
  });

  it("falha de leitura nunca rejeita: vira 'sem lote', com log", async () => {
    getNewsBatchForAnalysis.mockRejectedValue(new Error("neon fora"));
    expect(await loadStoredMatchNews(MATCH, NOW)).toEqual({ stored: null, notChecked: false });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("batchItemsInWindow", () => {
  it("[min(agora, apito) − 72h, min(agora, apito)]", () => {
    const items = [item(1, 2), item(2, 71), item(3, 73), item(4, -1)];
    expect(batchItemsInWindow(items, KICKOFF, NOW).map((i) => i.ref)).toEqual(["N1", "N2"]);
    // Depois do apito, a âncora é o apito: o item publicado depois dele sai.
    const after = new Date(KICKOFF.getTime() + 2 * HOUR);
    const late = { ...item(5, 0), publishedAt: new Date(KICKOFF.getTime() + HOUR).toISOString() };
    expect(batchItemsInWindow([late], KICKOFF, after)).toEqual([]);
  });

  it("data inválida sai", () => {
    expect(batchItemsInWindow([{ ...item(1, 1), publishedAt: "ontem" }], KICKOFF, NOW)).toEqual([]);
  });
});

describe("labels das notícias", () => {
  const TEAMS = { home: "SE Palmeiras", away: "CR Flamengo" };

  it("frase do código por fator, com o time do lado da pergunta", () => {
    expect(newsFactorPhrase("defense_weakened_away", TEAMS)).toBe(
      "Desfalque na defesa do CR Flamengo",
    );
    expect(newsFactorPhrase("attack_weakened_home", TEAMS)).toBe(
      "Desfalque no ataque do SE Palmeiras",
    );
    expect(newsFactorPhrase("rotation_risk_home", TEAMS)).toBe(
      "Time poupado ou rodízio no SE Palmeiras",
    );
    expect(newsFactorPhrase("high_stakes_away", TEAMS)).toBe("Jogo de peso para o CR Flamengo");
    expect(splitQuestionId("high_stakes_home")).toEqual({ factor: "high_stakes", side: "home" });
  });

  it("título inseguro: casa de aposta (inclusive 'Brasileirão Betano') ou linguagem de valor", () => {
    expect(isUnsafeNewsTitle("Palmeiras x Flamengo no Brasileirão Betano")).toBe(true);
    expect(isUnsafeNewsTitle("Flamengo tem as melhores odds da rodada")).toBe(true);
    expect(isUnsafeNewsTitle("Escalação do Flamengo: três desfalques")).toBe(false);
  });
});
