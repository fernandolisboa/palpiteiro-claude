// Provider HTTP client. Composes concurrency + throttle + retry around fetch,
// extracts quota headers, and emits structured logs. Cache lookups and
// schema validation stay in the per-provider modules — the client is the
// transport layer only.

import {
  createConcurrencyLimiter,
  type ConcurrencyLimiter,
} from "@/lib/providers/http/concurrency";
import {
  DEFAULT_RETRY_OPTIONS,
  RetryableHttpError,
  withRetry,
  type RetryOptions,
} from "@/lib/providers/http/retry";
import {
  createThrottler,
  type Throttler,
  type ThrottlerOptions,
} from "@/lib/providers/http/throttle";
import {
  extractQuota,
  logCall,
  type ExtractedQuota,
  type QuotaHeaderMapping,
} from "@/lib/providers/http/quota-logger";

export class HttpClientError extends Error {
  readonly statusCode: number;
  readonly body: string;
  constructor(statusCode: number, body: string, message?: string) {
    super(message ?? `HTTP ${statusCode}`);
    this.name = "HttpClientError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class HttpClientTimeoutError extends Error {
  constructor(endpoint: string) {
    super(`HTTP request timed out for ${endpoint}`);
    this.name = "HttpClientTimeoutError";
  }
}

export type ProviderClientConfig = {
  name: string;
  concurrency: number;
  throttle: ThrottlerOptions;
  quotaHeaders: QuotaHeaderMapping;
  timeoutMs?: number;
  retry?: Partial<Omit<RetryOptions, "shouldRetry">>;
};

export type ProviderRequest = {
  endpoint: string;
  url: string;
  init?: RequestInit;
};

export type ProviderResponse = {
  response: Response;
  text: string;
  quota: ExtractedQuota;
  statusCode: number;
  latencyMs: number;
  attempts: number;
};

export type ProviderClient = {
  send: (req: ProviderRequest) => Promise<ProviderResponse>;
  logCacheHit: (endpoint: string, latencyMs: number) => void;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof RetryableHttpError) return true;
  if (err instanceof HttpClientError) return false; // non-transient HTTP
  if (err instanceof HttpClientTimeoutError) return true;
  // Network-level errors (DNS, ECONNRESET, fetch failure) — retry.
  if (err instanceof Error) {
    const name = err.name;
    if (name === "AbortError" || name === "TimeoutError") return true;
    // node fetch surfaces TypeError on network failure.
    if (err instanceof TypeError) return true;
  }
  return false;
}

export function createProviderClient(
  config: ProviderClientConfig,
): ProviderClient {
  const concurrency: ConcurrencyLimiter = createConcurrencyLimiter(
    config.concurrency,
  );
  const throttle: Throttler = createThrottler(config.throttle);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOpts: RetryOptions = {
    maxAttempts: config.retry?.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts,
    baseDelayMs: config.retry?.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs,
    factor: config.retry?.factor ?? DEFAULT_RETRY_OPTIONS.factor,
    jitterRatio: config.retry?.jitterRatio ?? DEFAULT_RETRY_OPTIONS.jitterRatio,
    shouldRetry,
    random: config.retry?.random,
  };

  const send = (req: ProviderRequest): Promise<ProviderResponse> => {
    return concurrency(() =>
      throttle(() =>
        withRetry(async (attempt) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const start = Date.now();
          let statusCode: number | null = null;
          let quota: ExtractedQuota | undefined;

          try {
            const response = await fetch(req.url, {
              ...req.init,
              signal: controller.signal,
            });
            statusCode = response.status;
            quota = extractQuota(response.headers, config.quotaHeaders);
            const text = await response.text();
            const latencyMs = Date.now() - start;

            if (isTransientStatus(response.status)) {
              const retryAfter = Number(response.headers.get("retry-after"));
              const err = new RetryableHttpError(
                response.status,
                text.slice(0, 2048),
                Number.isFinite(retryAfter) ? retryAfter : undefined,
              );
              logCall({
                provider: config.name,
                endpoint: req.endpoint,
                cache_hit: false,
                latency_ms: latencyMs,
                status_code: statusCode,
                attempt,
                quota,
                error: `transient ${response.status}`,
              });
              throw err;
            }

            if (!response.ok) {
              const err = new HttpClientError(
                response.status,
                text.slice(0, 2048),
                `HTTP ${response.status} on ${req.endpoint}`,
              );
              logCall({
                provider: config.name,
                endpoint: req.endpoint,
                cache_hit: false,
                latency_ms: latencyMs,
                status_code: statusCode,
                attempt,
                quota,
                error: err.message,
              });
              throw err;
            }

            logCall({
              provider: config.name,
              endpoint: req.endpoint,
              cache_hit: false,
              latency_ms: latencyMs,
              status_code: statusCode,
              attempt,
              quota,
            });

            return {
              response,
              text,
              quota,
              statusCode: response.status,
              latencyMs,
              attempts: attempt,
            };
          } catch (err) {
            const isAbort =
              err instanceof Error &&
              (err.name === "AbortError" || err.name === "TimeoutError");
            if (isAbort) {
              const timeoutErr = new HttpClientTimeoutError(req.endpoint);
              logCall({
                provider: config.name,
                endpoint: req.endpoint,
                cache_hit: false,
                latency_ms: Date.now() - start,
                status_code: statusCode,
                attempt,
                quota,
                error: timeoutErr.message,
              });
              throw timeoutErr;
            }
            if (err instanceof RetryableHttpError || err instanceof HttpClientError) {
              throw err;
            }
            // Network-level error.
            logCall({
              provider: config.name,
              endpoint: req.endpoint,
              cache_hit: false,
              latency_ms: Date.now() - start,
              status_code: statusCode,
              attempt,
              quota,
              error:
                err instanceof Error ? `network: ${err.message}` : "network error",
            });
            throw err;
          } finally {
            clearTimeout(timer);
          }
        }, retryOpts),
      ),
    );
  };

  const logCacheHit = (endpoint: string, latencyMs: number): void => {
    logCall({
      provider: config.name,
      endpoint,
      cache_hit: true,
      latency_ms: latencyMs,
      status_code: null,
      attempt: 0,
    });
  };

  return { send, logCacheHit };
}

export { RetryableHttpError };
