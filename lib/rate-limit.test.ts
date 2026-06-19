import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.fn();
const fixedWindow = vi.fn((n: number) => ({ algo: "fixed", n }));

// Registra o prefixo do limiter cuja .limit() rodou de fato, pra que os testes
// possam asseverar QUAL limiter (user vs admin) foi selecionado — não só que
// ambos foram construídos. Sem isso, rotear admin->user passaria silencioso.
const limitedPrefixes: string[] = [];

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
    __opts: { prefix?: string } | undefined;
    constructor(opts: { prefix?: string }) {
      this.__opts = opts;
    }
    // Encaminha pro mockLimit (resolved value/assertions de chamada), mas grava
    // o prefixo da instância concreta que recebeu a chamada.
    limit(...args: unknown[]) {
      limitedPrefixes.push(this.__opts?.prefix ?? "");
      return mockLimit(...args);
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

// Carrega ambos os checks do MESMO módulo (mesmo singleton de limiters) pra provar
// o isolamento entre análise e palpites num único processo.
async function loadBoth() {
  const mod = await import("@/lib/rate-limit");
  return {
    checkAnalysisRateLimit: mod.checkAnalysisRateLimit,
    checkPalpitesRateLimit: mod.checkPalpitesRateLimit,
  };
}

beforeEach(() => {
  vi.resetModules();
  mockLimit.mockReset();
  fixedWindow.mockClear();
  limitedPrefixes.length = 0;
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
  vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY", "20");
  vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY_ADMIN", "200");
  vi.stubEnv("RATE_LIMIT_PALPITES_PER_DAY", "50");
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
    // O que importa: a .limit() que rodou foi a do limiter de admin, não a do
    // user. Sem essa asserção, rotear admin->user passaria verde.
    expect(limitedPrefixes).toEqual(["ratelimit:analyze:admin"]);
    expect(mockLimit).toHaveBeenCalledWith("admin1");
    expect(res.limit).toBe(200);
  });

  it("selects the user limiter for role 'user'", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: 0,
    });
    const check = await load();
    await check("u1", "user");
    expect(limitedPrefixes).toEqual(["ratelimit:analyze"]);
    expect(mockLimit).toHaveBeenCalledWith("u1");
  });

  it("selects the user limiter when role is undefined", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: 0,
    });
    const check = await load();
    await check("u1");
    expect(limitedPrefixes).toEqual(["ratelimit:analyze"]);
  });

  it("admin fails OPEN (ok:true, Infinity) and never touches Redis when KV env is unset", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await load();
    const res = await check("a1", "admin");
    // ADR 0023: o dono roda `pnpm dev` sem KV — admin nunca trava as análises.
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(Infinity);
    // fail-OPEN não carrega o discriminador de fail-closed (contrato do caller).
    expect(res.reason).toBeUndefined();
    expect(mockLimit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("non-admin fails CLOSED (ok:false, limit:0) and never touches Redis when KV env is unset", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await load();
    // ADR 0023: sem o teto, um usuário comum gastaria Anthropic sem limite quando
    // o cadastro abrir — recusar é o default seguro de custo. reason:"fail-closed"
    // (não limit:0) sinaliza fail-closed pro caller (copy de indisponibilidade).
    expect(await check("u1")).toEqual({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    // role explícito "user" tem o mesmo fallback fechado.
    expect(await check("u2", "user")).toMatchObject({
      ok: false,
      reason: "fail-closed",
    });
    expect(mockLimit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns only once across multiple KV-unset calls (any role)", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await load();
    await check("u1");
    await check("a1", "admin");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("falls back to the default limit for NaN/zero/negative env values", async () => {
    for (const bad of ["not-a-number", "0", "-5"]) {
      vi.resetModules();
      fixedWindow.mockClear();
      vi.stubEnv("RATE_LIMIT_ANALYSES_PER_DAY", bad);
      mockLimit.mockResolvedValue({
        success: true,
        limit: 20,
        remaining: 19,
        reset: 0,
      });
      const check = await load();
      await check("u1");
      // <=0 e NaN caem no default (20), nunca num limiter que bloqueia todo mundo.
      expect(fixedWindow).toHaveBeenCalledWith(20, "1 d");
    }
  });
});

describe("checkPalpitesRateLimit — bucket isolado (#315)", () => {
  it("usa o prefixo DISTINTO ratelimit:palpites (nunca o de análise)", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 50,
      remaining: 49,
      reset: 0,
    });
    const { checkPalpitesRateLimit } = await loadBoth();
    const res = await checkPalpitesRateLimit("u1");
    // A .limit() que rodou foi a do bucket palpites — não a de analyze/admin.
    expect(limitedPrefixes).toEqual(["ratelimit:palpites"]);
    expect(mockLimit).toHaveBeenCalledWith("u1");
    expect(res).toEqual({ ok: true, limit: 50, remaining: 49, reset: 0 });
    // O bucket de palpites é construído com seu próprio default (50/dia).
    expect(fixedWindow).toHaveBeenCalledWith(50, "1 d");
  });

  it("o palpite NÃO incrementa o limiter de análise (buckets distintos)", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 50,
      remaining: 49,
      reset: 0,
    });
    const { checkAnalysisRateLimit, checkPalpitesRateLimit } = await loadBoth();
    // Auto-run de palpite: bate SÓ o bucket palpites.
    await checkPalpitesRateLimit("u1");
    // Análise paga em seguida: bate SÓ o bucket analyze (user).
    await checkAnalysisRateLimit("u1", "user");
    // Prova de isolamento: a sequência de prefixos atingidos é palpites, depois
    // analyze — o palpite jamais drena os 20/dia de análise (e vice-versa).
    expect(limitedPrefixes).toEqual([
      "ratelimit:palpites",
      "ratelimit:analyze",
    ]);
  });

  it("retorna ok:false quando atinge o teto", async () => {
    mockLimit.mockResolvedValue({
      success: false,
      limit: 50,
      remaining: 0,
      reset: 999,
    });
    const { checkPalpitesRateLimit } = await loadBoth();
    const res = await checkPalpitesRateLimit("u1");
    expect(res.ok).toBe(false);
    expect(res.limit).toBe(50);
  });

  it("fail-OPEN (ok:true, Infinity) sem KV — decisão final PLAN §3", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkPalpitesRateLimit } = await loadBoth();
    const res = await checkPalpitesRateLimit("u1");
    // Diferente da análise não-admin (fail-CLOSED): palpite é barato + silencioso.
    expect(res).toEqual({
      ok: true,
      limit: Infinity,
      remaining: Infinity,
      reset: 0,
    });
    // fail-open não carrega o discriminador de fail-closed.
    expect(res.reason).toBeUndefined();
    expect(mockLimit).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("default 50/dia em env NaN/zero/negativo", async () => {
    for (const bad of ["not-a-number", "0", "-1"]) {
      vi.resetModules();
      fixedWindow.mockClear();
      vi.stubEnv("RATE_LIMIT_PALPITES_PER_DAY", bad);
      mockLimit.mockResolvedValue({
        success: true,
        limit: 50,
        remaining: 49,
        reset: 0,
      });
      const { checkPalpitesRateLimit } = await loadBoth();
      await checkPalpitesRateLimit("u1");
      expect(fixedWindow).toHaveBeenCalledWith(50, "1 d");
    }
  });
});
