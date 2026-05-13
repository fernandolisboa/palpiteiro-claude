// Sliding-window throttle. Allows at most `maxRequests` runs to start within
// any `windowMs` interval. Excess callers wait until the oldest timestamp in
// the window falls outside it. FIFO ordering is preserved across waiters.

export type ThrottlerOptions = {
  maxRequests: number;
  windowMs: number;
};

export type Throttler = <T>(fn: () => Promise<T>) => Promise<T>;

export function createThrottler(opts: ThrottlerOptions): Throttler {
  if (!Number.isInteger(opts.maxRequests) || opts.maxRequests < 1) {
    throw new Error(
      `createThrottler: maxRequests must be a positive integer, got ${opts.maxRequests}`,
    );
  }
  if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
    throw new Error(
      `createThrottler: windowMs must be > 0, got ${opts.windowMs}`,
    );
  }

  const { maxRequests, windowMs } = opts;
  const timestamps: number[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  const acquire = async (): Promise<void> => {
    while (true) {
      const now = Date.now();
      while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
        timestamps.shift();
      }
      if (timestamps.length < maxRequests) {
        timestamps.push(now);
        return;
      }
      const waitMs = timestamps[0] + windowMs - now + 1;
      await sleep(waitMs);
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    // Serialize the *acquire* step so waiters honor FIFO order; the actual
    // `fn()` runs concurrently once its slot is reserved.
    const slot = chain.then(() => acquire());
    chain = slot.catch(() => undefined);
    return slot.then(fn);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
