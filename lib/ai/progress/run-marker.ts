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
// Marcador `running` mais velho que isso é de uma função que morreu sem gravar o fim
// (teto da rota 300 s + folga): vale como ausente, a página não volta a "analisando".
export const RUN_MARKER_MAX_AGE_MS = 330_000;
// No máximo uma escrita por intervalo durante o run (a última etapa sempre sai).
const WRITE_INTERVAL_MS = 1_500;
// Cada comando ao KV espera no máximo isso, sem novas tentativas: o marcador é aviso, e
// um KV lento não pode segurar o run nem a página.
const KV_TIMEOUT_MS = 1_000;
// A página não espera o KV mais que isso: sem resposta, segue sem o marcador.
const PAGE_READ_TIMEOUT_MS = 400;

let cached: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  cached ??= new Redis({
    url,
    token,
    retry: false,
    signal: () => AbortSignal.timeout(KV_TIMEOUT_MS),
  });
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

// Leitura do marcador. `known: false` = o KV não respondeu (erro ou tempo): não dá pra
// dizer se há run, diferente de `run: null` (não há).
export type RunMarkerRead = { known: true; run: RunSnapshot | null } | { known: false };

export async function readRunMarkerResult(
  userId: string,
  matchId: string,
  opts?: { timeoutMs?: number; now?: number },
): Promise<RunMarkerRead> {
  const key = runMarkerKey(userId, matchId);
  const redis = getRedis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = redis ? redis.get<unknown>(key) : inMemoryCache.get<unknown>(key);
    const raw = await (opts?.timeoutMs === undefined
      ? read
      : Promise.race([
          read,
          new Promise<typeof TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMED_OUT), opts.timeoutMs);
          }),
        ]));
    if (raw === TIMED_OUT) return { known: false };
    const run = parseRunSnapshot(raw);
    const now = opts?.now ?? Date.now();
    // Função que morreu sem gravar o fim: o marcador `running` não vale mais.
    if (run?.status === "running" && now - run.startedAt > RUN_MARKER_MAX_AGE_MS) {
      return { known: true, run: null };
    }
    return { known: true, run };
  } catch (err) {
    logError("read_failed", err);
    return { known: false };
  } finally {
    clearTimeout(timer);
  }
}

const TIMED_OUT = Symbol("timed-out");

// Pra página do jogo: nunca espera o KV mais que um instante; sem resposta, sem run.
export async function readRunMarker(
  userId: string,
  matchId: string,
): Promise<RunSnapshot | null> {
  const read = await readRunMarkerResult(userId, matchId, {
    timeoutMs: PAGE_READ_TIMEOUT_MS,
  });
  return read.known ? read.run : null;
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
  now?: () => number;
}): RunMarkerWriter {
  const key = runMarkerKey(opts.userId, opts.matchId);
  const intervalMs = opts.intervalMs ?? WRITE_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const steps: RunStepSnapshot[] = [];
  let started = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Uma escrita por vez, e só a mais nova espera: com o KV lento, as etapas do meio
  // são puladas em vez de formar fila (o desfecho nunca fica atrás de etapas velhas).
  let inFlight: Promise<void> | null = null;
  let next: { snap: RunSnapshot; ttlMs: number } | null = null;
  let lastWriteEnd = 0;

  const snapshot = (
    status: RunSnapshot["status"],
    outcome: HeroRunOutcome | null,
  ): RunSnapshot => ({
    runId: opts.runId,
    intent: opts.intent,
    live: opts.live,
    startedAt,
    status,
    steps: steps.slice(),
    outcome,
  });

  const pump = (): Promise<void> => {
    if (inFlight) return inFlight;
    const job = next;
    if (!job) return Promise.resolve();
    next = null;
    inFlight = writeSnapshot(key, job.snap, job.ttlMs)
      .catch((err: unknown) => logError("write_failed", err))
      .then(() => {
        lastWriteEnd = now();
        inFlight = null;
        return pump();
      });
    return inFlight;
  };

  const write = (snap: RunSnapshot, ttlMs: number) => {
    started = true;
    next = { snap, ttlMs };
    return pump();
  };

  const flush = () => {
    timer = null;
    if (finished) return;
    void write(snapshot("running", null), RUN_MARKER_RUNNING_TTL_MS);
  };

  return {
    step(event) {
      if (finished) return;
      const { t: _t, ...step } = event;
      const i = steps.findIndex((s) => s.id === step.id);
      if (i === -1) steps.push(step);
      else steps[i] = step;
      if (timer) return;
      const wait = started ? lastWriteEnd + intervalMs - now() : 0;
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    async finish(outcome) {
      if (finished) return inFlight ?? undefined;
      finished = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!started) return;
      await write(snapshot("done", outcome), RUN_MARKER_DONE_TTL_MS);
      // A escrita em voo pode ter sido a de uma etapa: espera a do desfecho também.
      await pump();
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
