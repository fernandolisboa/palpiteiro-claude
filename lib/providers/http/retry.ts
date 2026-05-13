// Exponential backoff with jitter. Wraps `fn` and retries when
// `shouldRetry(err, attempt)` returns true, up to `maxAttempts` total tries.
//
// Backoff: baseDelayMs * factor^(attempt-1), with ±jitterRatio*100% noise.
// If the thrown error exposes `retryAfterSeconds`, that overrides the
// computed backoff (used to honor 429 `Retry-After` headers).

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  factor: number;
  jitterRatio: number;
  shouldRetry: (err: unknown, attempt: number) => boolean;
  // Allow injecting deterministic randomness for tests.
  random?: () => number;
};

export const DEFAULT_RETRY_OPTIONS: Omit<RetryOptions, "shouldRetry"> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  factor: 2,
  jitterRatio: 0.2,
};

export class RetryableHttpError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds: number | undefined;
  readonly body: string;
  constructor(statusCode: number, body: string, retryAfterSeconds?: number) {
    super(`Retryable HTTP ${statusCode}`);
    this.name = "RetryableHttpError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

export function backoffDelayMs(
  attempt: number,
  opts: Pick<RetryOptions, "baseDelayMs" | "factor" | "jitterRatio"> & {
    random?: () => number;
  },
): number {
  const base = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
  const rand = opts.random ?? Math.random;
  const jitter = base * opts.jitterRatio * (rand() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= opts.maxAttempts || !opts.shouldRetry(err, attempt)) {
        throw err;
      }
      const retryAfter =
        err instanceof RetryableHttpError ? err.retryAfterSeconds : undefined;
      const delay =
        retryAfter !== undefined && Number.isFinite(retryAfter)
          ? Math.max(0, retryAfter * 1000)
          : backoffDelayMs(attempt, opts);
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
