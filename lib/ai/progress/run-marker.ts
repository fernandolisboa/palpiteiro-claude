// Marcador do run em voo, por pessoa e jogo (adendo da ADR 0064). A rota de streaming
// grava aqui as etapas que já rodaram; a página do jogo e o GET da rota releem. Assim
// quem sai do jogo no meio da análise e volta (outra navegação, F5, outra aba) vê o
// mesmo run seguindo e o resultado quando ele termina, sem depender da conexão que
// começou o run.
//
// Vercel KV (Upstash), como o lock dos crons; sem KV (dev/test) cai no cache em memória
// do processo. Nunca lança: marcador é só aviso, o run e a página seguem sem ele.

import { Redis } from "@upstash/redis";

import { inMemoryCache } from "@/lib/cache/in-memory";

import {
  parseRunSnapshot,
  type HeroRunOutcome,
  type ProgressEvent,
  type RunIntent,
  type RunSnapshot,
  type RunStepSnapshot,
} from "./protocol";

// Run em voo: o teto da rota (maxDuration 300s) e uma folga. Uma função morta no meio
// (sem gravar o fim) some sozinha depois disso.
export const RUN_MARKER_RUNNING_TTL_MS = 360_000;
// Run terminado: só o bastante pra quem acompanha ler o desfecho.
export const RUN_MARKER_DONE_TTL_MS = 120_000;
// No máximo uma escrita por intervalo durante o run (a última etapa sempre sai).
const WRITE_INTERVAL_MS = 1_500;
// A página não espera o KV mais que isso: sem resposta, segue sem o marcador.
const READ_TIMEOUT_MS = 400;

let cached: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached ??= new Redis({ url, token });
  return cached;
}

export function runMarkerKey(userId: string, matchId: string): string {
  return `palpite:run:${userId}:${matchId}`;
}

async function writeSnapshot(key: string, snapshot: RunSnapshot, ttlMs: number) {
  const redis = getRedis();
  if (!redis) {
    await inMemoryCache.set(key, snapshot, ttlMs);
    return;
  }
  await redis.set(key, snapshot, { ex: Math.ceil(ttlMs / 1000) });
}

export async function readRunMarker(
  userId: string,
  matchId: string,
): Promise<RunSnapshot | null> {
  const key = runMarkerKey(userId, matchId);
  const redis = getRedis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      redis ? redis.get<unknown>(key) : inMemoryCache.get<unknown>(key),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
      }),
    ]);
    return parseRunSnapshot(raw);
  } catch (err) {
    logError("read_failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type RunMarkerWriter = {
  step(event: ProgressEvent): void;
  // Grava o desfecho. Resolve quando a escrita terminou (a rota segura a função até lá).
  finish(outcome: HeroRunOutcome): Promise<void>;
};

/**
 * Acompanha as etapas do run e grava o marcador. A 1ª etapa grava na hora (é ela que
 * diz "tem run em voo"); as seguintes, no máximo uma vez a cada 1,5s. Run que não
 * passou dos gates (nenhuma etapa) não grava nada. As escritas vão em fila: o desfecho
 * nunca é sobrescrito por uma escrita de etapa atrasada.
 */
export function createRunMarkerWriter(opts: {
  userId: string;
  matchId: string;
  runId: string;
  intent: RunIntent;
  live: boolean;
  intervalMs?: number;
}): RunMarkerWriter {
  const key = runMarkerKey(opts.userId, opts.matchId);
  const intervalMs = opts.intervalMs ?? WRITE_INTERVAL_MS;
  const steps: RunStepSnapshot[] = [];
  let written = false;
  let finished = false;
  let lastWriteAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const snapshot = (
    status: RunSnapshot["status"],
    outcome: HeroRunOutcome | null,
  ): RunSnapshot => ({
    runId: opts.runId,
    intent: opts.intent,
    live: opts.live,
    status,
    steps: steps.slice(),
    outcome,
  });

  const enqueue = (snap: RunSnapshot, ttlMs: number) => {
    written = true;
    lastWriteAt = Date.now();
    queue = queue
      .then(() => writeSnapshot(key, snap, ttlMs))
      .catch((err: unknown) => logError("write_failed", err));
  };

  const flush = () => {
    timer = null;
    if (finished) return;
    enqueue(snapshot("running", null), RUN_MARKER_RUNNING_TTL_MS);
  };

  return {
    step(event) {
      if (finished) return;
      const { t: _t, ...step } = event;
      const i = steps.findIndex((s) => s.id === step.id);
      if (i === -1) steps.push(step);
      else steps[i] = step;
      if (timer) return;
      const wait = written ? lastWriteAt + intervalMs - Date.now() : 0;
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    finish(outcome) {
      if (finished) return queue;
      finished = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (written) enqueue(snapshot("done", outcome), RUN_MARKER_DONE_TTL_MS);
      return queue;
    },
  };
}

function logError(error: string, err: unknown) {
  console.error(
    JSON.stringify({
      scope: "palpiteRunMarker",
      error,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}
