import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThrottler } from "@/lib/providers/http/throttle";

describe("createThrottler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects invalid config", () => {
    expect(() => createThrottler({ maxRequests: 0, windowMs: 1000 })).toThrow();
    expect(() => createThrottler({ maxRequests: 1, windowMs: 0 })).toThrow();
    expect(() => createThrottler({ maxRequests: -1, windowMs: 1000 })).toThrow();
  });

  it("lets the first N calls through immediately", async () => {
    const throttle = createThrottler({ maxRequests: 5, windowMs: 1000 });
    const results: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) =>
      throttle(async () => {
        results.push(i);
      }),
    );
    await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("delays calls beyond the window until the oldest slot expires", async () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const throttle = createThrottler({ maxRequests: 2, windowMs: 1000 });

    const order: Array<{ id: number; t: number }> = [];
    const fire = (id: number) =>
      throttle(async () => {
        order.push({ id, t: Date.now() });
      });

    const promises = [fire(0), fire(1), fire(2), fire(3)];

    // First two should resolve immediately (without advancing timers).
    await Promise.all([promises[0], promises[1]]);
    expect(order.map((o) => o.id)).toEqual([0, 1]);

    // Advance past the window — the next two should fire.
    await vi.advanceTimersByTimeAsync(1001);
    await Promise.all(promises);
    expect(order.map((o) => o.id)).toEqual([0, 1, 2, 3]);
    expect(order[2].t - order[0].t).toBeGreaterThanOrEqual(1000);
    expect(order[3].t - order[1].t).toBeGreaterThanOrEqual(1000);
  });

  it("serializes a burst of 100 under a 10/window limit", async () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const throttle = createThrottler({ maxRequests: 10, windowMs: 1000 });

    const launchedAt: number[] = [];
    const promises = Array.from({ length: 100 }, () =>
      throttle(async () => {
        launchedAt.push(Date.now());
      }),
    );

    // Drain by stepping the clock 1s at a time. Total expected duration:
    // 100 / 10 = 10 windows → ~9_000ms minimum (slot 11 fires at 1s, slot 21
    // at 2s, ..., slot 100 at 9s).
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(1001);
    }
    await Promise.all(promises);

    expect(launchedAt).toHaveLength(100);
    // No window of 1s should contain more than 10 acquires.
    for (let i = 10; i < launchedAt.length; i++) {
      expect(launchedAt[i] - launchedAt[i - 10]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("preserves FIFO ordering across waiters", async () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const throttle = createThrottler({ maxRequests: 1, windowMs: 100 });

    const order: number[] = [];
    const promises = Array.from({ length: 5 }, (_, i) =>
      throttle(async () => {
        order.push(i);
      }),
    );
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(101);
    }
    await Promise.all(promises);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});
