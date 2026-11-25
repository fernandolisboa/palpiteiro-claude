/**
 * Portão dos crons frequentes no KV (#680, ADR 0074). O Neon do plano Free tem 100 CU-h
 * por mês e só suspende o compute depois de 5 min sem query: cada run de cron que toca
 * o Postgres segura o banco acordado por ≥ 5 min. Os crons de 10 min (recheck-lineups)
 * e 30 min (capture-closing-odds) só têm trabalho perto do apito de um jogo ANALISADO,
 * então perguntam primeiro a este índice no KV (Upstash) e só descem pro Postgres
 * quando há jogo na janela.
 *
 * Índice: sorted set `matchId → kickoff (epoch ms)` dos jogos com predição de pré-jogo.
 *   - Gravado no insert da predição (`noteAnalyzedKickoff`, best-effort). ZADD que
 *     falha derruba o carimbo: o portão volta a `null` até o próximo rebuild.
 *   - Reconstruído no fim de todo sync de fixtures (`refreshAnalyzedKickoffs`, a cada
 *     6 h pelo cron e também pelo toggle do /admin/leagues e pelo after() da lista).
 *     Só faz upsert (sem DEL): um ZADD concorrente do insert nunca se perde.
 *   - O carimbo `built-at` (TTL de 2 ciclos do sync + folga) diz que o índice bate com
 *     os kickoffs do banco. O sync o apaga ANTES de gravar kickoff
 *     (`invalidateAnalyzedKickoffs`) e o rebuild o regrava no fim: sync que morre no
 *     meio deixa o portão em `null`, nunca respondendo com kickoff velho.
 *   - Membro sentinela (`__built__`, score fora de qualquer janela) gravado pelo
 *     rebuild: se o KV despejar o set e deixar o carimbo, o portão também cai em `null`.
 * Sem carimbo ou sem sentinela, o portão responde `null` e o cron segue o caminho
 * antigo, direto no Postgres (fail-open).
 *
 * Corrida aceita: uma análise que leu o kickoff antes de um sync remarcar o jogo grava
 * o kickoff velho depois do rebuild; o próximo sync corrige.
 */

import { Redis } from "@upstash/redis";

import { getUpcomingAnalyzedKickoffs } from "@/lib/db/queries/predictions";

export const ANALYZED_KICKOFFS_KEY = "analyzed-kickoffs:v1";
export const ANALYZED_KICKOFFS_BUILT_KEY = "analyzed-kickoffs:v1:built-at";
// 2 ciclos do sync-fixtures (6 h) + folga: um sync que falha uma vez não derruba o portão.
export const ANALYZED_KICKOFFS_BUILT_TTL_MS = 13 * 60 * 60_000;
// Jogo que já começou há mais que isto sai do índice (nenhum cron olha pra trás).
const KEEP_PAST_MS = 6 * 60 * 60_000;
// Sentinela: score acima de qualquer janela, nunca cortado pelo ZREMRANGEBYSCORE.
export const ANALYZED_KICKOFFS_SENTINEL = "__built__";
const SENTINEL_SCORE = Number.MAX_SAFE_INTEGER;

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
 * Derruba o carimbo: até o próximo rebuild o portão responde `null` (caminho antigo).
 * Best-effort, nunca lança. Chamado antes de o sync gravar kickoffs e quando um ZADD
 * do insert falha.
 */
export async function invalidateAnalyzedKickoffs(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(ANALYZED_KICKOFFS_BUILT_KEY);
  } catch (err) {
    logWarn("invalidate_failed", err);
  }
}

/**
 * Registra no índice o jogo de uma predição de pré-jogo recém-gravada. Nunca lança: a
 * predição já está no banco. Se o ZADD falhar, derruba o carimbo (o portão abre até o
 * próximo rebuild) em vez de deixar o jogo de fora.
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
    await invalidateAnalyzedKickoffs();
  }
}

/**
 * Reconstrói o índice a partir do Postgres (no fim do sync, com o banco já acordado).
 * Devolve quantos jogos entraram, ou null sem KV. Lança se o banco ou o KV falharem;
 * `refreshAnalyzedKickoffs` é a versão que só loga.
 */
export async function rebuildAnalyzedKickoffs(
  opts: { now?: Date } = {},
): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  const now = opts.now ?? new Date();
  const rows = await getUpcomingAnalyzedKickoffs({ now });
  const tx = redis.multi();
  tx.zadd(
    ANALYZED_KICKOFFS_KEY,
    { score: SENTINEL_SCORE, member: ANALYZED_KICKOFFS_SENTINEL },
    ...rows.map((r) => ({ score: r.kickoffAt.getTime(), member: r.matchId })),
  );
  tx.zremrangebyscore(ANALYZED_KICKOFFS_KEY, "-inf", now.getTime() - KEEP_PAST_MS);
  tx.set(ANALYZED_KICKOFFS_BUILT_KEY, now.getTime(), {
    ex: Math.ceil(ANALYZED_KICKOFFS_BUILT_TTL_MS / 1000),
  });
  await tx.exec();
  return rows.length;
}

/** `rebuildAnalyzedKickoffs` que nunca lança: falha só loga (o carimbo segue apagado). */
export async function refreshAnalyzedKickoffs(): Promise<void> {
  try {
    const indexed = await rebuildAnalyzedKickoffs();
    if (indexed !== null) {
      console.log(JSON.stringify({ scope: SCOPE, event: "rebuilt", indexed }));
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: SCOPE,
        event: "rebuild_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Há jogo analisado com kickoff em [fromMs, toMs]? `false` = com certeza não (o cron
 * sai sem tocar no Postgres). `null` = não dá pra saber (sem KV, sem carimbo, set
 * despejado, erro no KV): o cron segue o caminho antigo.
 */
export async function hasAnalyzedKickoffBetween(
  fromMs: number,
  toMs: number,
): Promise<boolean | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const [builtAt, sentinel, count] = await Promise.all([
      redis.get<number | string>(ANALYZED_KICKOFFS_BUILT_KEY),
      redis.zscore(ANALYZED_KICKOFFS_KEY, ANALYZED_KICKOFFS_SENTINEL),
      redis.zcount(ANALYZED_KICKOFFS_KEY, fromMs, toMs),
    ]);
    if (builtAt === null || builtAt === undefined) return null;
    if (sentinel === null || sentinel === undefined) return null;
    return count > 0;
  } catch (err) {
    logWarn("gate_failed", err);
    return null;
  }
}
