/**
 * Portão dos crons frequentes no KV (#680, ADR 0074). O Neon do plano Free tem 100 CU-h
 * por mês e só suspende o compute depois de 5 min sem query: cada run de cron que toca
 * o Postgres segura o banco acordado por ≥ 5 min. Os crons de 10 min (recheck-lineups)
 * e 30 min (capture-closing-odds) só têm trabalho perto do apito de um jogo ANALISADO,
 * então perguntam primeiro a este índice no KV (Upstash) e só descem pro Postgres
 * quando há jogo na janela.
 *
 * Índice: sorted set `matchId → kickoff (epoch ms)` dos jogos com predição de pré-jogo.
 *   - Gravado no insert da predição (`noteAnalyzedKickoff`, best-effort).
 *   - Reconstruído pelo sync-fixtures a cada 6 h (`rebuildAnalyzedKickoffs`), que
 *     conserta jogo remarcado, insert cujo ZADD falhou e despejo do KV. Só faz upsert
 *     (sem DEL): um ZADD concorrente do insert nunca se perde.
 *   - O carimbo `built-at` (TTL de 2 ciclos do sync + folga) diz que o índice está
 *     completo. Sem carimbo (nunca construído, despejado, sync parado), o portão
 *     responde `null` e o cron segue o caminho antigo, direto no Postgres (fail-open).
 *
 * Membro velho (jogo remarcado pra depois, predição de jogo adiado) só custa um run
 * que desce pro Postgres à toa; o rebuild e o corte de passado limpam.
 */

import { Redis } from "@upstash/redis";

import { getUpcomingAnalyzedKickoffs } from "@/lib/db/queries/predictions";

export const ANALYZED_KICKOFFS_KEY = "analyzed-kickoffs:v1";
export const ANALYZED_KICKOFFS_BUILT_KEY = "analyzed-kickoffs:v1:built-at";
// 2 ciclos do sync-fixtures (6 h) + folga: um sync que falha uma vez não derruba o portão.
export const ANALYZED_KICKOFFS_BUILT_TTL_MS = 13 * 60 * 60_000;
// Jogo que já começou há mais que isto sai do índice (nenhum cron olha pra trás).
const KEEP_PAST_MS = 6 * 60 * 60_000;

const SCOPE = "analyzed_kickoffs";

let cached: Redis | null = null;

// Mesmo padrão de lib/sync/lock.ts e lib/rate-limit.ts: construção explícita com as
// envs do Vercel KV, sob demanda. Sem KV (dev/test) → null → portão aberto.
function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  if (!cached) cached = new Redis({ url, token });
  return cached;
}

function logWarn(event: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      scope: SCOPE,
      event,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Registra no índice o jogo de uma predição de pré-jogo recém-gravada. Nunca lança: a
 * predição já está no banco, e o rebuild de 6 h cobre um ZADD perdido.
 */
export async function noteAnalyzedKickoff(
  matchId: string,
  kickoffAt: Date,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.zadd(ANALYZED_KICKOFFS_KEY, {
      score: kickoffAt.getTime(),
      member: matchId,
    });
  } catch (err) {
    logWarn("note_failed", err);
  }
}

/**
 * Reconstrói o índice a partir do Postgres (chamado pelo sync-fixtures, que já acordou
 * o banco). Devolve quantos jogos entraram, ou null sem KV. Lança se o banco ou o KV
 * falharem: o chamador loga e segue; sem carimbo novo, o portão volta a abrir sozinho
 * quando o TTL vencer.
 */
export async function rebuildAnalyzedKickoffs(
  opts: { now?: Date } = {},
): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  const now = opts.now ?? new Date();
  const rows = await getUpcomingAnalyzedKickoffs({ now });
  const tx = redis.multi();
  if (rows.length > 0) {
    const [first, ...rest] = rows.map((r) => ({
      score: r.kickoffAt.getTime(),
      member: r.matchId,
    }));
    tx.zadd(ANALYZED_KICKOFFS_KEY, first, ...rest);
  }
  tx.zremrangebyscore(ANALYZED_KICKOFFS_KEY, "-inf", now.getTime() - KEEP_PAST_MS);
  tx.set(ANALYZED_KICKOFFS_BUILT_KEY, now.getTime(), {
    ex: Math.ceil(ANALYZED_KICKOFFS_BUILT_TTL_MS / 1000),
  });
  await tx.exec();
  return rows.length;
}

/**
 * Há jogo analisado com kickoff em [fromMs, toMs]? `false` = com certeza não (o cron
 * sai sem tocar no Postgres). `null` = não dá pra saber (sem KV, índice sem carimbo,
 * erro no KV): o cron segue o caminho antigo.
 */
export async function hasAnalyzedKickoffBetween(
  fromMs: number,
  toMs: number,
): Promise<boolean | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const [builtAt, count] = await Promise.all([
      redis.get<number | string>(ANALYZED_KICKOFFS_BUILT_KEY),
      redis.zcount(ANALYZED_KICKOFFS_KEY, fromMs, toMs),
    ]);
    if (builtAt === null || builtAt === undefined) return null;
    return count > 0;
  } catch (err) {
    logWarn("gate_failed", err);
    return null;
  }
}
