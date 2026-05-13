import { describe, expect, it } from "vitest";

import { createConcurrencyLimiter } from "@/lib/providers/http/concurrency";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createConcurrencyLimiter", () => {
  it("rejects invalid max", () => {
    expect(() => createConcurrencyLimiter(0)).toThrow();
    expect(() => createConcurrencyLimiter(-1)).toThrow();
    expect(() => createConcurrencyLimiter(1.5)).toThrow();
  });

  it("never exceeds max in-flight under burst", async () => {
    const limit = createConcurrencyLimiter(3);
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 100 }, () =>
      limit(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("releases slots in FIFO order", async () => {
    const limit = createConcurrencyLimiter(1);
    const order: number[] = [];
    const blockers = Array.from({ length: 5 }, () => deferred<void>());

    const tasks = blockers.map((d, i) =>
      limit(async () => {
        order.push(i);
        await d.promise;
      }),
    );

    // Unblock sequentially; FIFO means task i+1 only starts after task i resolves.
    for (let i = 0; i < blockers.length; i++) {
      await Promise.resolve(); // let limit dispatch
      blockers[i].resolve();
    }
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("propagates rejections and still releases the slot", async () => {
    const limit = createConcurrencyLimiter(1);
    await expect(
      limit(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // If the slot was leaked this would hang forever.
    await expect(limit(async () => 42)).resolves.toBe(42);
  });
});
