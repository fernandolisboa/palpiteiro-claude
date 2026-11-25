import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Portão dos crons frequentes no KV (#680, ADR 0074). Redis fake em memória: o que
// importa é o contrato do portão (false só com índice construído e sem jogo na janela;
// null em qualquer dúvida) e que o rebuild só faz upsert (nunca apaga um ZADD
// concorrente do insert).

const zsets = new Map<string, Map<string, number>>();
const strings = new Map<string, unknown>();
const setOpts = new Map<string, unknown>();
let failNext = false;

function zset(key: string): Map<string, number> {
  let z = zsets.get(key);
  if (!z) zsets.set(key, (z = new Map()));
  return z;
}

function maybeFail() {
  if (failNext) {
    failNext = false;
    throw new Error("kv down");
  }
}

class FakeRedis {
  async zadd(key: string, ...members: { score: number; member: string }[]) {
    maybeFail();
    for (const m of members) zset(key).set(m.member, m.score);
    return members.length;
  }
  async zcount(key: string, min: number, max: number) {
    maybeFail();
    return [...zset(key).values()].filter((s) => s >= min && s <= max).length;
  }
  async zscore(key: string, member: string) {
    maybeFail();
    return zset(key).get(member) ?? null;
  }
  async get(key: string) {
    maybeFail();
    return strings.get(key) ?? null;
  }
  async del(key: string) {
    maybeFail();
    const had = strings.delete(key) || zsets.delete(key);
    return had ? 1 : 0;
  }
  multi() {
    const ops: (() => void)[] = [];
    const tx = {
      zadd: (key: string, ...members: { score: number; member: string }[]) => {
        ops.push(() => members.forEach((m) => zset(key).set(m.member, m.score)));
        return tx;
      },
      zremrangebyscore: (key: string, _min: string, max: number) => {
        ops.push(() => {
          for (const [m, s] of zset(key)) if (s <= max) zset(key).delete(m);
        });
        return tx;
      },
      set: (key: string, value: unknown, opts?: unknown) => {
        ops.push(() => {
          strings.set(key, value);
          setOpts.set(key, opts);
        });
        return tx;
      },
      exec: async () => {
        maybeFail();
        ops.forEach((op) => op());
        return [];
      },
    };
    return tx;
  }
}

// O factory sobe pro topo (hoist): a classe fake só é resolvida no `new`, já inicializada.
vi.mock("@upstash/redis", () => ({
  Redis: function Redis() {
    return new FakeRedis();
  },
}));

const getUpcomingAnalyzedKickoffs = vi.fn();
vi.mock("@/lib/db/queries/predictions", () => ({
  getUpcomingAnalyzedKickoffs: (...a: unknown[]) => getUpcomingAnalyzedKickoffs(...a),
}));

import {
  ANALYZED_KICKOFFS_BUILT_KEY,
  ANALYZED_KICKOFFS_KEY,
  ANALYZED_KICKOFFS_SENTINEL,
  hasAnalyzedKickoffBetween,
  invalidateAnalyzedKickoffs,
  noteAnalyzedKickoff,
  rebuildAnalyzedKickoffs,
  refreshAnalyzedKickoffs,
} from "@/lib/sync/analyzed-kickoffs";

const NOW = new Date("2026-11-25T18:00:00Z");
const MIN = 60_000;
const at = (m: number) => new Date(NOW.getTime() + m * MIN);

beforeEach(() => {
  zsets.clear();
  strings.clear();
  setOpts.clear();
  failNext = false;
  getUpcomingAnalyzedKickoffs.mockReset().mockResolvedValue([]);
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "t");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hasAnalyzedKickoffBetween", () => {
  it("índice nunca construído (sem carimbo) → null: o cron segue pro banco", async () => {
    await noteAnalyzedKickoff("m1", at(30));
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
  });

  it("índice construído: false sem jogo na janela, true com jogo (limites inclusivos)", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBe(false);

    await noteAnalyzedKickoff("m1", at(90));
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBe(true);
    expect(await hasAnalyzedKickoffBetween(at(90).getTime(), at(120).getTime())).toBe(true);
    expect(await hasAnalyzedKickoffBetween(at(91).getTime(), at(120).getTime())).toBe(false);
    expect(await hasAnalyzedKickoffBetween(at(5).getTime(), at(75).getTime())).toBe(false);
  });

  it("set despejado com o carimbo ainda lá (sem sentinela) → null", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    zsets.delete(ANALYZED_KICKOFFS_KEY);
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
  });

  it("carimbo derrubado (sync gravando kickoffs) → null até o próximo rebuild", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    await invalidateAnalyzedKickoffs();
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
    await rebuildAnalyzedKickoffs({ now: NOW });
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBe(false);
  });

  it("sentinela nunca cai numa janela real", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    expect(
      await hasAnalyzedKickoffBetween(NOW.getTime(), at(60 * 24 * 365).getTime()),
    ).toBe(false);
  });

  it("erro no KV → null (fail-open), sem lançar", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    failNext = true;
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
  });

  it("sem KV configurado (dev/test) → null", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
  });
});

describe("noteAnalyzedKickoff", () => {
  it("grava matchId → kickoff", async () => {
    await noteAnalyzedKickoff("m1", at(30));
    expect(zset(ANALYZED_KICKOFFS_KEY).get("m1")).toBe(at(30).getTime());
  });

  it("ZADD que falha não lança e derruba o carimbo (portão abre em vez de pular o jogo)", async () => {
    await rebuildAnalyzedKickoffs({ now: NOW });
    failNext = true;
    await expect(noteAnalyzedKickoff("m2", at(30))).resolves.toBeUndefined();
    expect(strings.has(ANALYZED_KICKOFFS_BUILT_KEY)).toBe(false);
    expect(await hasAnalyzedKickoffBetween(NOW.getTime(), at(90).getTime())).toBeNull();
  });
});

describe("rebuildAnalyzedKickoffs", () => {
  it("upsert do banco + carimbo; não apaga ZADD concorrente; corta o passado; corrige kickoff remarcado", async () => {
    // Jogo antigo (passou do corte de 6 h) e um ZADD do insert que o scan não viu.
    zset(ANALYZED_KICKOFFS_KEY).set("old", at(-7 * 60).getTime());
    zset(ANALYZED_KICKOFFS_KEY).set("fresh-insert", at(40).getTime());
    zset(ANALYZED_KICKOFFS_KEY).set("moved", at(30).getTime());
    getUpcomingAnalyzedKickoffs.mockResolvedValue([
      { matchId: "a", kickoffAt: at(120) },
      { matchId: "moved", kickoffAt: at(300) },
    ]);

    expect(await rebuildAnalyzedKickoffs({ now: NOW })).toBe(2);
    expect(getUpcomingAnalyzedKickoffs).toHaveBeenCalledWith({ now: NOW });
    const z = zset(ANALYZED_KICKOFFS_KEY);
    expect(z.has("old")).toBe(false);
    expect(z.get("fresh-insert")).toBe(at(40).getTime());
    expect(z.get("a")).toBe(at(120).getTime());
    expect(z.get("moved")).toBe(at(300).getTime());
    expect(z.get(ANALYZED_KICKOFFS_SENTINEL)).toBe(Number.MAX_SAFE_INTEGER);
    expect(strings.get(ANALYZED_KICKOFFS_BUILT_KEY)).toBe(NOW.getTime());
    // TTL do carimbo em SEGUNDOS: 13 h = 2 ciclos do sync (6 h) + folga.
    expect(setOpts.get(ANALYZED_KICKOFFS_BUILT_KEY)).toEqual({ ex: 13 * 60 * 60 });
  });

  it("refreshAnalyzedKickoffs nunca lança e não grava carimbo se o banco falhar", async () => {
    getUpcomingAnalyzedKickoffs.mockRejectedValue(new Error("db down"));
    await expect(refreshAnalyzedKickoffs()).resolves.toBeUndefined();
    expect(strings.has(ANALYZED_KICKOFFS_BUILT_KEY)).toBe(false);
  });

  it("sem KV → null, sem consultar o banco", async () => {
    vi.stubEnv("KV_REST_API_TOKEN", "");
    expect(await rebuildAnalyzedKickoffs({ now: NOW })).toBeNull();
    expect(getUpcomingAnalyzedKickoffs).not.toHaveBeenCalled();
  });
});
