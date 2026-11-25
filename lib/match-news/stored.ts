import { MATCH_NEWS_EXTRACT_VERSION } from "@/lib/ai/match-news/extract-cartridge";
import { hasTypeSafeKey } from "@/lib/ai/providers/typesafe/client";
import {
  getEnableMatchModelJev,
  getEnableNewsFactors,
} from "@/lib/db/queries/ai-config";
import {
  getMatchNewsByIds,
  getNewsBatchForAnalysis,
} from "@/lib/db/queries/match-news";
import type { NewsResult } from "@/lib/providers/news/types";

import { NEWS_WINDOW_MS } from "./apply";
import { isUnsafeNewsTitle } from "./labels";
import type { MatchNewsBatchItem, StoredNewsBatch } from "./types";

// As notícias GUARDADAS do jogo lidas pela análise (#672, C2; PLAN-672 §7 + ajustes 1,
// 10 e 12). Mesma fonte pro número (predict code_jev aplica o lote) e pro texto (a
// síntese recebe os itens do lote): o passo "N lidas · K viraram fator" bate com o que
// a síntese viu. Sem lote usável e fresco, a análise segue no caminho ao vivo (#670).

// Lote usável pra análise: visto pelo cron nas últimas 12h (= a janela da base,
// MODEL_BASE_JEV_REUSE_WINDOW_MS / NEWS_BATCH_USABLE_MS).
export const STORED_NEWS_FRESH_MS = 12 * 60 * 60 * 1000;

// Memo por jogo: todos os mercados de um run (e o predict, a action e a síntese) leem o
// MESMO lote, com uma leitura só. Curto: o cron grava lote novo a cada 6h.
const MEMO_TTL_MS = 60_000;
// Teto de jogos no memo (instância quente de longa vida): ao inserir, saem os vencidos
// e, se ainda cheio, os mais antigos.
export const MEMO_MAX_ENTRIES = 200;

export type StoredMatchNews = {
  // O lote: `ok` (com afirmações) ou `empty` (o ge respondeu sem item).
  batch: StoredNewsBatch;
  // Os itens do lote na janela das fontes, na ordem do ranking, com o trecho guardado
  // (match_news), prontos pra síntese. Sem título com nome de casa de aposta ou
  // linguagem de valor (ajuste 12): o item sai do texto, a afirmação dele continua no
  // número (a base aplica o mesmo lote inteiro).
  results: NewsResult[];
  // A notícia pode virar fator nesta análise: as MESMAS condições da base (flag do JEV
  // da base ligada e chave da TypeSafe presente). Sem isso, o lote só vira texto.
  factorsEnabled: boolean;
};

export type StoredNewsLookup = {
  stored: StoredMatchNews | null;
  // Sem lote usável e o cron viu um lote que a extração não leu: o passo ao vivo avisa
  // que as notícias de hoje ainda não foram conferidas.
  notChecked: boolean;
};

type MatchRef = { id: string; kickoffAt: Date };

const NONE: StoredNewsLookup = { stored: null, notChecked: false };

const memo = new Map<string, { expiresAt: number; value: Promise<StoredNewsLookup> }>();

/** Só pros testes: esquece o memo. */
export function resetStoredMatchNewsMemo(): void {
  memo.clear();
}

/** Só pros testes: quantos jogos estão no memo. */
export function storedMatchNewsMemoSize(): number {
  return memo.size;
}

function memoSet(matchId: string, value: Promise<StoredNewsLookup>): void {
  const nowMs = Date.now();
  for (const [id, entry] of memo) {
    if (entry.expiresAt <= nowMs) memo.delete(id);
  }
  // Reinserir vai pro fim da ordem de inserção (= o mais novo).
  memo.delete(matchId);
  while (memo.size >= MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
  memo.set(matchId, { expiresAt: nowMs + MEMO_TTL_MS, value });
}

/** Itens do lote dentro da janela das fontes ([min(agora, apito) − 72h, min(agora, apito)]). */
export function batchItemsInWindow(
  items: readonly MatchNewsBatchItem[],
  kickoffAt: Date,
  now: Date,
): MatchNewsBatchItem[] {
  const anchorMs = Math.min(now.getTime(), kickoffAt.getTime());
  const fromMs = anchorMs - NEWS_WINDOW_MS;
  return items.filter((i) => {
    const ms = Date.parse(i.publishedAt);
    return Number.isFinite(ms) && ms >= fromMs && ms <= anchorMs;
  });
}

/**
 * O lote guardado do jogo pra análise, memoizado por jogo. Flag `enable_news_factors`
 * desligada → nada (caminho ao vivo). Nunca rejeita: falha de leitura vira "sem lote".
 */
export function loadStoredMatchNews(
  match: MatchRef,
  now: Date = new Date(),
): Promise<StoredNewsLookup> {
  const hit = memo.get(match.id);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = readStoredMatchNews(match, now).catch((err: unknown) => {
    console.error(
      JSON.stringify({
        scope: "match_news",
        matchId: match.id,
        error: "stored_news_read_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NONE;
  });
  memoSet(match.id, value);
  return value;
}

async function readStoredMatchNews(match: MatchRef, now: Date): Promise<StoredNewsLookup> {
  // As duas flags numa ida só; com enable_news_factors desligada, nada mais é lido.
  const [newsFlag, jevFlag] = await Promise.all([
    getEnableNewsFactors(),
    getEnableMatchModelJev(),
  ]);
  if (!newsFlag) return NONE;
  const { usable, failedOnly } = await getNewsBatchForAnalysis(match.id, {
    since: new Date(now.getTime() - STORED_NEWS_FRESH_MS),
    promptVersion: MATCH_NEWS_EXTRACT_VERSION,
  });
  if (!usable) return { stored: null, notChecked: failedOnly };
  const inWindow = batchItemsInWindow(usable.items, match.kickoffAt, now);
  const rows = await getMatchNewsByIds(inWindow.map((i) => i.newsId));
  const snippetById = new Map(rows.map((r) => [r.id, r.snippet]));
  const results: NewsResult[] = inWindow
    .filter((i) => !isUnsafeNewsTitle(i.title))
    .map((i) => {
      const snippet = snippetById.get(i.newsId);
      return {
        title: i.title,
        url: i.url,
        ...(snippet ? { snippet } : {}),
        publishedAt: i.publishedAt,
        source: "ge" as const,
      };
    });
  const factorsEnabled = jevFlag && hasTypeSafeKey();
  return { stored: { batch: usable, results, factorsEnabled }, notChecked: false };
}
