import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.fn();
const fixedWindow = vi.fn((n: number) => ({ algo: "fixed", n }));

// Construtores como funções normais (não vi.fn().mockImplementation) pra que a
// implementação sobreviva ao vi.resetModules() de cada teste.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    __cfg: unknown;
    constructor(cfg: unknown) {
      this.__cfg = cfg;
    }
  },
}));
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    __opts: unknown;
    limit = mockLimit;
    constructor(opts: unknown) {
      this.__opts = opts;
    }
    // Fábrica estática usada como Ratelimit.fixedWindow(...).
    static fixedWindow = fixedWindow;
  }
  return { Ratelimit };
});

// O módulo memoiza o singleton dos limiters; cada teste que precisa de uma
// construção fresca chama vi.resetModules() (no beforeEach) e re-importa.
async function load() {
  const mod = await import("@/lib/rate-limit");
  return mod.checkAnalysisRateLimit;
}

beforeEach(() => {
  vi.resetModules();
  mockLimit.mockReset();
  fixedWindow.mockClear();
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
  vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY", "20");
  vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY_ADMIN", "200");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkAnalysisRateLimit", () => {
  it("passes through ok:true with limit/remaining/reset when under the limit", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: 123,
    });
    const check = await load();
    expect(await check("u1")).toEqual({
      ok: true,
      limit: 20,
      remaining: 19,
      reset: 123,
    });
  });

  it("returns ok:false when at/over the limit", async () => {
    mockLimit.mockResolvedValue({
      success: false,
      limit: 20,
      remaining: 0,
      reset: 123,
    });
    const check = await load();
    const res = await check("u1");
    expect(res.ok).toBe(false);
    expect(res.limit).toBe(20);
  });

  it("selects the admin limiter (separate, higher limit) for role 'admin'", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 200,
      remaining: 199,
      reset: 0,
    });
    const check = await load();
    const res = await check("admin1", "admin");
    // Ambos limiters são construídos no factory: user (20) e admin (200).
    expect(fixedWindow).toHaveBeenCalledWith(20, "1 d");
    expect(fixedWindow).toHaveBeenCalledWith(200, "1 d");
    expect(res.limit).toBe(200);
  });

  it("fails open (ok:true) and never touches Redis when KV env is unset", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await load();
    const res = await check("u1");
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(Infinity);
    expect(mockLimit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("falls back to the default limit when the env value is NaN", async () => {
    vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY", "not-a-number");
    mockLimit.mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: 0,
    });
    const check = await load();
    await check("u1");
    expect(fixedWindow).toHaveBeenCalledWith(20, "1 d");
  });
});
