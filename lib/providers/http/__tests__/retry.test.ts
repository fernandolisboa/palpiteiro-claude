import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backoffDelayMs,
  RetryableHttpError,
  withRetry,
  type RetryOptions,
} from "@/lib/providers/http/retry";

function baseOpts(over: Partial<RetryOptions> = {}): RetryOptions {
  return {
    maxAttempts: 3,
    baseDelayMs: 1000,
    factor: 2,
    jitterRatio: 0.2,
    shouldRetry: () => true,
    random: () => 0.5, // jitter = 0 with center at 0.5
    ...over,
  };
}

describe("backoffDelayMs", () => {
  it("grows exponentially without jitter", () => {
    const opts = { baseDelayMs: 1000, factor: 2, jitterRatio: 0, random: () => 0.5 };
    expect(backoffDelayMs(1, opts)).toBe(1000);
    expect(backoffDelayMs(2, opts)).toBe(2000);
    expect(backoffDelayMs(3, opts)).toBe(4000);
  });

  it("applies ±jitterRatio bounded noise", () => {
    const opts = { baseDelayMs: 1000, factor: 2, jitterRatio: 0.2 };
    for (let i = 0; i < 20; i++) {
      const delay = backoffDelayMs(2, opts);
      // base = 2000, jitter ±20% → [1600, 2400]
      expect(delay).toBeGreaterThanOrEqual(1600);
      expect(delay).toBeLessThanOrEqual(2400);
    }
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, baseOpts())).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects maxAttempts and rethrows last error", async () => {
    const err = new RetryableHttpError(500, "fail");
    const fn = vi.fn().mockRejectedValue(err);
    const opts = baseOpts({ maxAttempts: 3 });
    const promise = withRetry(fn, opts);
    promise.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const err = Object.assign(new Error("400"), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    const opts = baseOpts({ shouldRetry: () => false });
    await expect(withRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and 5xx via RetryableHttpError", async () => {
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new RetryableHttpError(429, "rl"))
      .mockRejectedValueOnce(new RetryableHttpError(503, "down"))
      .mockResolvedValueOnce("ok");
    const opts = baseOpts({
      shouldRetry: (e) => e instanceof RetryableHttpError,
    });
    const promise = withRetry(fn, opts);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 4xx other than 429 (caller policy)", async () => {
    class HttpError extends Error {
      status: number;
      constructor(status: number) {
        super(`HTTP ${status}`);
        this.status = status;
      }
    }
    const err = new HttpError(404);
    const fn = vi.fn().mockRejectedValue(err);
    const opts = baseOpts({
      shouldRetry: (e) =>
        e instanceof RetryableHttpError ||
        (e instanceof HttpError && (e.status === 429 || e.status >= 500)),
    });
    await expect(withRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After (retryAfterSeconds) over computed backoff", async () => {
    const err = new RetryableHttpError(429, "rl", 7);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw err;
      return "ok";
    });
    const promise = withRetry(fn, baseOpts());
    // Computed backoff for attempt 1 would be ~1000ms; Retry-After says 7s.
    await vi.advanceTimersByTimeAsync(6_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    await expect(promise).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("waits the computed backoff between attempts", async () => {
    const err = new RetryableHttpError(500, "x");
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("ok");
    const opts = baseOpts({ jitterRatio: 0 });
    const promise = withRetry(fn, opts);
    // Backoff for attempt 1 = 1000ms exactly (jitter=0).
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
