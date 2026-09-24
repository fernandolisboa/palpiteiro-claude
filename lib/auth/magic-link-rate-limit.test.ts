import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.fn();
const fixedWindow = vi.fn((n: number, w: string) => ({ algo: "fixed", n, w }));

// Registra o (prefix, key) do limiter cuja .limit() rodou de fato, pra que os
// testes possam asseverar prefixo e chave normalizada.
const limited: Array<{ prefix: string; key: unknown }> = [];

// Construtores como classes normais (não vi.fn().mockImplementation) pra que a
// implementação sobreviva ao vi.resetModules() de cada teste — igual rate-limit.test.
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
    __opts: { prefix?: string } | undefined;
    constructor(opts: { prefix?: string }) {
      this.__opts = opts;
    }
    limit(key: unknown) {
      limited.push({ prefix: this.__opts?.prefix ?? "", key });
      return mockLimit(key);
    }
    static fixedWindow = fixedWindow;
  }
  return { Ratelimit };
});

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

// O módulo memoiza o singleton; cada teste re-importa após vi.resetModules().
async function load() {
  const mod = await import("@/lib/auth/magic-link-rate-limit");
  return mod.checkMagicLinkRateLimit;
}

async function loadIp() {
  const mod = await import("@/lib/auth/magic-link-rate-limit");
  return mod.checkMagicLinkIpRateLimit;
}

async function loadGlobal() {
  const mod = await import("@/lib/auth/magic-link-rate-limit");
  return mod.checkMagicLinkGlobalRateLimit;
}

beforeEach(() => {
  vi.resetModules();
  captureMessage.mockReset();
  mockLimit.mockReset();
  fixedWindow.mockClear();
  limited.length = 0;
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
  vi.stubEnv("RATE_LIMIT_MAGIC_LINK_PER_HOUR", "5");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkMagicLinkRateLimit", () => {
  it("retorna true quando abaixo do teto", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await load();
    expect(await check("a@ex.com")).toBe(true);
  });

  it("retorna false quando estoura o teto", async () => {
    mockLimit.mockResolvedValue({ success: false });
    const check = await load();
    expect(await check("a@ex.com")).toBe(false);
  });

  it("usa o prefixo 'ratelimit:magic-link' e a janela de 1h", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await load();
    await check("a@ex.com");
    expect(fixedWindow).toHaveBeenCalledWith(5, "1 h");
    expect(limited).toEqual([
      { prefix: "ratelimit:magic-link", key: "a@ex.com" },
    ]);
  });

  it("chaveia pelo e-mail NORMALIZADO (trim+lowercase)", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await load();
    await check("  A@EX.COM  ");
    expect(limited[0]?.key).toBe("a@ex.com");
  });

  it("fail-OPEN (true) + warn-once + NUNCA toca o Redis quando o KV está ausente", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await load();
    // Pré-auth sem role pra discriminar; o caminho de login não pode travar e a
    // guarda de custo do Anthropic (#264) é independente — fail-open (ADR 0023).
    expect(await check("a@ex.com")).toBe(true);
    expect(await check("b@ex.com")).toBe(true);
    expect(mockLimit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("cai no default (5) pra valores de env NaN/zero/negativos", async () => {
    for (const bad of ["not-a-number", "0", "-5"]) {
      vi.resetModules();
      fixedWindow.mockClear();
      vi.stubEnv("RATE_LIMIT_MAGIC_LINK_PER_HOUR", bad);
      mockLimit.mockResolvedValue({ success: true });
      const check = await load();
      await check("a@ex.com");
      expect(fixedWindow).toHaveBeenCalledWith(5, "1 h");
    }
  });
});

describe("checkMagicLinkIpRateLimit", () => {
  it("retorna true quando abaixo do teto", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await loadIp();
    expect(await check("203.0.113.7")).toBe(true);
  });

  it("retorna false quando estoura o teto", async () => {
    mockLimit.mockResolvedValue({ success: false });
    const check = await loadIp();
    expect(await check("203.0.113.7")).toBe(false);
  });

  it("usa prefixo/bucket próprios ('ratelimit:magic-link-ip'), chaveia pelo IP e default 10/1h", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await loadIp();
    await check("203.0.113.7");
    // Default 10 (sem RATE_LIMIT_MAGIC_LINK_IP_PER_HOUR no env), janela 1h, chave = IP cru.
    expect(fixedWindow).toHaveBeenCalledWith(10, "1 h");
    expect(limited).toEqual([
      { prefix: "ratelimit:magic-link-ip", key: "203.0.113.7" },
    ]);
  });

  it("fail-OPEN (true) sem KV — o caminho de login não pode travar", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await loadIp();
    expect(await check("203.0.113.7")).toBe(true);
    expect(mockLimit).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("checkMagicLinkIpRateLimit — override de env", () => {
  it("respeita RATE_LIMIT_MAGIC_LINK_IP_PER_HOUR", async () => {
    vi.stubEnv("RATE_LIMIT_MAGIC_LINK_IP_PER_HOUR", "3");
    mockLimit.mockResolvedValue({ success: true });
    const check = await loadIp();
    await check("2001:db8:1:2::/64");
    expect(fixedWindow).toHaveBeenCalledWith(3, "1 h");
    expect(limited).toEqual([
      { prefix: "ratelimit:magic-link-ip", key: "2001:db8:1:2::/64" },
    ]);
  });
});

describe("checkMagicLinkGlobalRateLimit", () => {
  it("usa bucket próprio ('ratelimit:magic-link-global'), chave fixa e default 80/24h", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const check = await loadGlobal();
    expect(await check()).toBe(true);
    expect(fixedWindow).toHaveBeenCalledWith(80, "24 h");
    expect(limited).toEqual([
      { prefix: "ratelimit:magic-link-global", key: "global" },
    ]);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("respeita RATE_LIMIT_MAGIC_LINK_GLOBAL_PER_DAY", async () => {
    vi.stubEnv("RATE_LIMIT_MAGIC_LINK_GLOBAL_PER_DAY", "40");
    mockLimit.mockResolvedValue({ success: true });
    const check = await loadGlobal();
    await check();
    expect(fixedWindow).toHaveBeenCalledWith(40, "24 h");
  });

  it("retorna false ao estourar e avisa o Sentry UMA vez por janela de throttle", async () => {
    mockLimit.mockResolvedValue({ success: false });
    const check = await loadGlobal();
    expect(await check()).toBe(false);
    expect(await check()).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      "magic-link global rate limit tripped",
      "warning"
    );
  });

  it("fail-OPEN (true) sem KV", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await loadGlobal();
    expect(await check()).toBe(true);
    expect(mockLimit).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("os três limiters são buckets independentes (um prefixo cada)", async () => {
    mockLimit.mockResolvedValue({ success: true });
    const mod = await import("@/lib/auth/magic-link-rate-limit");
    await mod.checkMagicLinkRateLimit("a@ex.com");
    await mod.checkMagicLinkIpRateLimit("203.0.113.7");
    await mod.checkMagicLinkGlobalRateLimit();
    expect(limited.map((l) => l.prefix)).toEqual([
      "ratelimit:magic-link",
      "ratelimit:magic-link-ip",
      "ratelimit:magic-link-global",
    ]);
  });
});
