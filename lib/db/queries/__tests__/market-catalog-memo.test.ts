import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// resolveMarketCatalog faz 2 leituras (markets → market_selections). O stub do db
// devolve as rows da fila `h.state.results` na ordem das queries e conta quantas
// queries rodaram — é isso que o memo tem que economizar.
const h = vi.hoisted(() => ({
  state: {
    results: [] as unknown[][],
    queries: 0,
    fail: false,
  },
}));

vi.mock("@/lib/db", () => {
  const select = vi.fn(() => {
    h.state.queries += 1;
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => {
      if (h.state.fail) return reject(new Error("neon fora"));
      return resolve(h.state.results.shift() ?? []);
    };
    return chain;
  });
  return { db: { select } };
});

import {
  clearMarketCatalogMemo,
  resolveMarketCatalog,
} from "@/lib/db/queries/market-catalog";

function queueCatalog(marketId: string, sels: { id: string; key: string }[]) {
  h.state.results.push([{ id: marketId }], sels);
}

const OU_SELS = [
  { id: "sel-over", key: "over" },
  { id: "sel-under", key: "under" },
];

beforeEach(() => {
  clearMarketCatalogMemo();
  h.state.results = [];
  h.state.queries = 0;
  h.state.fail = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveMarketCatalog (memo)", () => {
  it("segunda chamada do mesmo mercado não vai ao banco", async () => {
    queueCatalog("mkt-ou", OU_SELS);
    const first = await resolveMarketCatalog("over_under");
    const second = await resolveMarketCatalog("over_under");

    expect(h.state.queries).toBe(2);
    expect(second).toBe(first);
    expect(second.marketId).toBe("mkt-ou");
    expect(second.idByKey.get("under")).toBe("sel-under");
    expect(second.keyById.get("sel-over")).toBe("over");
  });

  it("chamadas concorrentes compartilham uma leitura só", async () => {
    queueCatalog("mkt-ou", OU_SELS);
    const [a, b, c] = await Promise.all([
      resolveMarketCatalog("over_under"),
      resolveMarketCatalog("over_under"),
      resolveMarketCatalog("over_under"),
    ]);
    expect(h.state.queries).toBe(2);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("mercados diferentes têm entradas separadas", async () => {
    queueCatalog("mkt-ou", OU_SELS);
    queueCatalog("mkt-mr", [
      { id: "sel-home", key: "home" },
      { id: "sel-draw", key: "draw" },
      { id: "sel-away", key: "away" },
    ]);
    const ou = await resolveMarketCatalog("over_under");
    const mr = await resolveMarketCatalog("match_result");
    expect(ou.marketId).toBe("mkt-ou");
    expect(mr.marketId).toBe("mkt-mr");
    expect(mr.idByKey.size).toBe(3);
  });

  it("falha não fica em cache: a próxima chamada tenta de novo", async () => {
    h.state.fail = true;
    await expect(resolveMarketCatalog("over_under")).rejects.toThrow("neon fora");

    h.state.fail = false;
    queueCatalog("mkt-ou", OU_SELS);
    const ok = await resolveMarketCatalog("over_under");
    expect(ok.marketId).toBe("mkt-ou");
  });

  it("mercado ausente segue hard-fail e também não fica em cache", async () => {
    h.state.results.push([]);
    await expect(resolveMarketCatalog("over_under")).rejects.toThrow(
      "não encontrado no catálogo",
    );
    queueCatalog("mkt-ou", OU_SELS);
    await expect(resolveMarketCatalog("over_under")).resolves.toMatchObject({
      marketId: "mkt-ou",
    });
  });

  it("expira depois do TTL e relê o catálogo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00Z"));
    queueCatalog("mkt-ou", OU_SELS);
    await resolveMarketCatalog("over_under");

    vi.setSystemTime(new Date("2026-10-13T00:09:59Z"));
    await resolveMarketCatalog("over_under");
    expect(h.state.queries).toBe(2);

    vi.setSystemTime(new Date("2026-10-13T00:10:01Z"));
    queueCatalog("mkt-ou-2", OU_SELS);
    const fresh = await resolveMarketCatalog("over_under");
    expect(h.state.queries).toBe(4);
    expect(fresh.marketId).toBe("mkt-ou-2");
  });

  it("mercado de seleções dinâmicas (artilheiro) nunca é memoizado", async () => {
    queueCatalog("mkt-scorer", [{ id: "s1", key: "scorer_a" }]);
    queueCatalog("mkt-scorer", [
      { id: "s1", key: "scorer_a" },
      { id: "s2", key: "scorer_b" },
    ]);
    const first = await resolveMarketCatalog("anytime_scorer");
    const second = await resolveMarketCatalog("anytime_scorer");
    expect(h.state.queries).toBe(4);
    expect(first.idByKey.size).toBe(1);
    expect(second.idByKey.size).toBe(2);
  });
});
