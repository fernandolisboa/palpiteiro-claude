import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSet = vi.fn();
const mockDel = vi.fn();

// Construtor como classe normal (não vi.fn().mockImplementation) pra que a
// implementação sobreviva ao vi.resetModules() de cada teste — espelha o mock
// de @upstash/redis em rate-limit.test.ts.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    __cfg: unknown;
    constructor(cfg: unknown) {
      this.__cfg = cfg;
    }
    set(...args: unknown[]) {
      return mockSet(...args);
    }
    del(...args: unknown[]) {
      return mockDel(...args);
    }
  },
}));

const KEY = "sync:upcoming-fixtures:lock";

// O módulo memoiza o singleton do Redis; cada teste re-importa após
// vi.resetModules() (no beforeEach) pra obter uma construção fresca.
async function load() {
  return import("@/lib/sync/lock");
}

beforeEach(() => {
  vi.resetModules();
  mockSet.mockReset();
  mockDel.mockReset();
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("acquireSyncLock / releaseSyncLock — KV path", () => {
  it("exports the stable lock key", async () => {
    const { SYNC_LOCK_KEY } = await load();
    expect(SYNC_LOCK_KEY).toBe(KEY);
  });

  it("acquires when SET NX returns OK", async () => {
    mockSet.mockResolvedValue("OK");
    const { acquireSyncLock } = await load();

    const acquired = await acquireSyncLock({ ttlMs: 7 * 60 * 60 * 1000 });

    expect(acquired).toBe(true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    const [key, , opts] = mockSet.mock.calls[0];
    expect(key).toBe(KEY);
    // NX setado + EX em segundos (7h = 25200s).
    expect(opts).toMatchObject({ nx: true, ex: 25200 });
  });

  it("does not acquire when SET NX returns null (already held)", async () => {
    mockSet.mockResolvedValue(null);
    const { acquireSyncLock } = await load();

    const acquired = await acquireSyncLock();

    expect(acquired).toBe(false);
  });

  it("a second concurrent acquire returns false while the first holds", async () => {
    mockSet.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    const { acquireSyncLock } = await load();

    expect(await acquireSyncLock()).toBe(true);
    expect(await acquireSyncLock()).toBe(false);
  });

  it("force:true issues a SET WITHOUT nx and always acquires", async () => {
    mockSet.mockResolvedValue("OK");
    const { acquireSyncLock } = await load();

    const acquired = await acquireSyncLock({ force: true });

    expect(acquired).toBe(true);
    const [, , opts] = mockSet.mock.calls[0];
    expect(opts).not.toHaveProperty("nx");
    expect(opts).toHaveProperty("ex");
  });

  it("release deletes the lock key", async () => {
    const { releaseSyncLock } = await load();

    await releaseSyncLock();

    expect(mockDel).toHaveBeenCalledTimes(1);
    expect(mockDel).toHaveBeenCalledWith(KEY);
  });
});

describe("acquireSyncLock / releaseSyncLock — in-memory fail-open", () => {
  beforeEach(() => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
  });

  it("falls back to in-memory (acquire true then false) and warns once, never touching Redis", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { acquireSyncLock, releaseSyncLock } = await load();

    // Garante estado limpo entre runs (o InMemoryCacheStore é um singleton).
    await releaseSyncLock();

    expect(await acquireSyncLock()).toBe(true);
    expect(await acquireSyncLock()).toBe(false);

    expect(mockSet).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    await releaseSyncLock();
    warn.mockRestore();
  });

  it("force:true acquires even when the in-memory lock is held", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { acquireSyncLock, releaseSyncLock } = await load();

    await releaseSyncLock();

    expect(await acquireSyncLock()).toBe(true);
    expect(await acquireSyncLock({ force: true })).toBe(true);

    await releaseSyncLock();
  });
});
