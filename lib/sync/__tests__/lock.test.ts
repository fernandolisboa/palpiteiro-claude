import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSet = vi.fn();
const mockDel = vi.fn();
const mockGet = vi.fn();

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
    get(...args: unknown[]) {
      return mockGet(...args);
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
  mockGet.mockReset();
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

describe("acquireKvLock / releaseKvLock — por chave (#555)", () => {
  beforeEach(() => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
  });

  it("chaves diferentes não colidem; a mesma chave → false até o release", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { acquireKvLock, releaseKvLock, acquireSyncLock, releaseSyncLock } =
      await load();
    await releaseKvLock("a:lock");
    await releaseKvLock("b:lock");
    await releaseSyncLock();

    expect(await acquireKvLock("a:lock")).toBe(true);
    expect(await acquireKvLock("b:lock")).toBe(true);
    expect(await acquireKvLock("a:lock")).toBe(false);
    // O lock do sync segue independente.
    expect(await acquireSyncLock()).toBe(true);

    await releaseKvLock("a:lock");
    expect(await acquireKvLock("a:lock")).toBe(true);

    await releaseKvLock("a:lock");
    await releaseKvLock("b:lock");
    await releaseSyncLock();
  });

  it("KV: SET NX EX na chave pedida e DEL na mesma chave", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://kv.example");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    mockSet.mockResolvedValue("OK");
    const { acquireKvLock, releaseKvLock } = await load();

    expect(await acquireKvLock("model-base:compute:lock", { ttlMs: 300_000 })).toBe(
      true,
    );
    const [key, , opts] = mockSet.mock.calls[0];
    expect(key).toBe("model-base:compute:lock");
    expect(opts).toMatchObject({ nx: true, ex: 300 });

    await releaseKvLock("model-base:compute:lock");
    expect(mockDel).toHaveBeenCalledWith("model-base:compute:lock");
  });
});

describe("readKvStamp / writeKvStamp — marcador e lock alheio (#619)", () => {
  it("KV: lê o carimbo (número ou string) sem tomar o lock; grava com EX, sem NX", async () => {
    const { readKvStamp, writeKvStamp } = await load();
    mockGet.mockResolvedValueOnce(1_700_000_000_000);
    expect(await readKvStamp("model-base:compute:lock")).toBe(1_700_000_000_000);
    mockGet.mockResolvedValueOnce("1700000000001");
    expect(await readKvStamp("x")).toBe(1_700_000_000_001);
    mockGet.mockResolvedValueOnce(null);
    expect(await readKvStamp("x")).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();

    mockSet.mockResolvedValue("OK");
    await writeKvStamp("lineup-recheck:done:m1", 42, 3 * 60 * 60_000);
    expect(mockSet).toHaveBeenCalledWith("lineup-recheck:done:m1", 42, {
      ex: 10_800,
    });
  });

  it("fail-open in-memory: escreve, lê e o release apaga", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readKvStamp, writeKvStamp, releaseKvLock, acquireKvLock } = await load();
    expect(await readKvStamp("m")).toBeNull();
    await writeKvStamp("m", 7, 60_000);
    expect(await readKvStamp("m")).toBe(7);
    await writeKvStamp("m", 9, 60_000);
    expect(await readKvStamp("m")).toBe(9);
    await releaseKvLock("m");
    expect(await readKvStamp("m")).toBeNull();
    // O carimbo de um lock tomado é visível pra quem só lê.
    expect(await acquireKvLock("l")).toBe(true);
    expect(await readKvStamp("l")).toEqual(expect.any(Number));
    await releaseKvLock("l");
    expect(mockGet).not.toHaveBeenCalled();
  });
});
