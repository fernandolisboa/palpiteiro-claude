// FIFO semaphore. Caps the number of Promise-returning tasks in flight at
// `max`. Tasks beyond the cap queue and run in arrival order as slots free up.
//
// API mirrors p-limit: `limit(fn)` returns a Promise that resolves with `fn`'s
// result once a slot is acquired.

export type ConcurrencyLimiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`createConcurrencyLimiter: max must be a positive integer, got ${max}`);
  }

  let active = 0;
  const waiters: Array<() => void> = [];

  const release = (): void => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active++;
        resolve();
      });
    });
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
