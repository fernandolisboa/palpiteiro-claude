import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: o factory do vi.mock é içado pro topo, então o estado que ele
// referencia precisa ser criado via vi.hoisted (também içado). Espelha o
// chain-stub de odds-snapshots.test.ts / users.test.ts.
const h = vi.hoisted(() => {
  const state = {
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitArg: undefined as unknown,
    limitCalled: false,
    rows: [] as unknown[],
  };
  return { state };
});

// Stub das condições do drizzle: cada operador vira um objeto inspecionável, então
// o que o .where()/.orderBy() captura carrega op+col+val literalmente — sem
// depender da serialização opaca do SQL real do drizzle. and() preserva a ordem,
// DROPA operandos undefined e — fiel ao drizzle v0.45.2 — retorna undefined
// quando NADA sobra (é disso que getMatchesInRange depende pra "todas as rows").
vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => {
    const filtered = conds.filter((c) => c !== undefined);
    return filtered.length ? { op: "and", conds: filtered } : undefined;
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
  lte: (col: unknown, val: unknown) => ({ op: "lte", col, val }),
  inArray: (col: unknown, val: unknown) => ({ op: "inArray", col, val }),
  asc: (col: unknown) => ({ op: "asc", col }),
  desc: (col: unknown) => ({ op: "desc", col }),
  // sql só é usado em upsertMatchesFromProvider; tag passthrough inofensivo.
  sql: (strings: TemplateStringsArray) => ({ op: "sql", strings }),
}));

// Stub do db: select().from().where().orderBy() captura os args e devolve um nó
// "thenable" que TAMBÉM expõe .limit(). Assim a query resolve pros rows quer
// getMatchesInRange chame .limit() (limit fornecido) ou não (sem limit).
vi.mock("@/lib/db", () => {
  const makeOrderByResult = () => {
    const result = {
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(h.state.rows).then(resolve),
      limit: vi.fn((n: unknown) => {
        h.state.limitCalled = true;
        h.state.limitArg = n;
        return Promise.resolve(h.state.rows);
      }),
    };
    return result;
  };
  const fromNode = {
    where: vi.fn((cond: unknown) => {
      h.state.whereArg = cond;
      return {
        orderBy: vi.fn((order: unknown) => {
          h.state.orderByArg = order;
          return makeOrderByResult();
        }),
      };
    }),
  };
  const select = vi.fn(() => ({ from: vi.fn(() => fromNode) }));
  return { db: { select } };
});

import { matches } from "@/db/schema";
import { getMatchesInRange, getUpcomingMatches } from "@/lib/db/queries/matches";

type Cond = { op?: string; col?: unknown; val?: unknown; conds?: Cond[] };

function andConds(): Cond[] {
  const where = h.state.whereArg as Cond | undefined;
  // and() vira undefined quando todos os operandos somem (fiel ao drizzle real);
  // nesse caso não há cláusula WHERE = nenhuma condição.
  if (where === undefined) return [];
  expect(where.op).toBe("and");
  return where.conds ?? [];
}

function findCond(op: string): Cond | undefined {
  return andConds().find((c) => c.op === op);
}

beforeEach(() => {
  h.state.whereArg = undefined;
  h.state.orderByArg = undefined;
  h.state.limitArg = undefined;
  h.state.limitCalled = false;
  h.state.rows = [];
});

describe("getMatchesInRange — range query flexível", () => {
  it("unbounded dos dois lados → and() vira undefined, WHERE sem filtro = todas as rows", async () => {
    const rows = [{ id: "m1" }, { id: "m2" }];
    h.state.rows = rows;

    await expect(
      getMatchesInRange({ from: null, to: null }),
    ).resolves.toEqual(rows);

    // Todos os operandos undefined → and() retorna undefined (igual ao drizzle
    // real v0.45.2), e .where(undefined) NÃO emite cláusula WHERE → TODAS as
    // rows, não zero. Travar que o predicado chegou como undefined é o contrato
    // de verdade (não a fidelidade do mock).
    expect(h.state.whereArg).toBeUndefined();
  });

  it("from-only → só gte(kickoffAt, from)", async () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    await getMatchesInRange({ from, to: null });

    expect(findCond("lte")).toBeUndefined();
    const gte = findCond("gte");
    expect(gte?.col).toBe(matches.kickoffAt);
    expect(gte?.val).toBe(from);
  });

  it("to-only → só lte(kickoffAt, to)", async () => {
    const to = new Date("2026-06-30T00:00:00.000Z");
    await getMatchesInRange({ from: null, to });

    expect(findCond("gte")).toBeUndefined();
    const lte = findCond("lte");
    expect(lte?.col).toBe(matches.kickoffAt);
    expect(lte?.val).toBe(to);
  });

  it("statuses → inArray(status, [...]); col travada, não só op", async () => {
    await getMatchesInRange({
      from: null,
      to: null,
      statuses: ["scheduled", "finished"],
    });

    const cond = findCond("inArray");
    expect(cond?.col).toBe(matches.status);
    expect(cond?.val).toEqual(["scheduled", "finished"]);
  });

  it("statuses vazio → NÃO aplica filtro de status", async () => {
    await getMatchesInRange({ from: null, to: null, statuses: [] });
    expect(findCond("inArray")).toBeUndefined();
  });

  it("league → eq(league, ...)", async () => {
    await getMatchesInRange({ from: null, to: null, league: "brasileirao_a" });

    const cond = findCond("eq");
    expect(cond?.col).toBe(matches.league);
    expect(cond?.val).toBe("brasileirao_a");
  });

  it("order default → asc(kickoffAt)", async () => {
    await getMatchesInRange({ from: null, to: null });
    const order = h.state.orderByArg as Cond;
    expect(order.op).toBe("asc");
    expect(order.col).toBe(matches.kickoffAt);
  });

  it("order='desc' → desc(kickoffAt)", async () => {
    await getMatchesInRange({ from: null, to: null, order: "desc" });
    const order = h.state.orderByArg as Cond;
    expect(order.op).toBe("desc");
    expect(order.col).toBe(matches.kickoffAt);
  });

  it("limit fornecido → aplica .limit(n)", async () => {
    await getMatchesInRange({ from: null, to: null, limit: 25 });
    expect(h.state.limitCalled).toBe(true);
    expect(h.state.limitArg).toBe(25);
  });

  it("limit 0 → aplica .limit(0), NÃO pula (guarda o `!== undefined`)", async () => {
    await getMatchesInRange({ from: null, to: null, limit: 0 });
    expect(h.state.limitCalled).toBe(true);
    expect(h.state.limitArg).toBe(0);
  });

  it("sem limit → NÃO chama .limit()", async () => {
    await getMatchesInRange({ from: null, to: null });
    expect(h.state.limitCalled).toBe(false);
  });
});

describe("getUpcomingMatches — wrapper sobre getMatchesInRange", () => {
  it("from=now, to=now+window, statuses [scheduled,live], asc, sem limit", async () => {
    const before = Date.now();
    await getUpcomingMatches();
    const after = Date.now();

    const gte = findCond("gte");
    const lte = findCond("lte");
    const from = gte?.val as Date;
    const to = lte?.val as Date;

    // from ≈ now (entre o antes/depois da chamada)
    expect(from.getTime()).toBeGreaterThanOrEqual(before);
    expect(from.getTime()).toBeLessThanOrEqual(after);

    // janela default = 48h
    expect(to.getTime() - from.getTime()).toBe(48 * 60 * 60 * 1000);

    // status scheduled+live via inArray
    const status = findCond("inArray");
    expect(status?.col).toBe(matches.status);
    expect(status?.val).toEqual(["scheduled", "live"]);

    // asc kickoffAt e sem limit
    const order = h.state.orderByArg as Cond;
    expect(order.op).toBe("asc");
    expect(order.col).toBe(matches.kickoffAt);
    expect(h.state.limitCalled).toBe(false);
  });

  it("windowHours custom → to = from + windowHours", async () => {
    await getUpcomingMatches({ windowHours: 6 });
    const from = (findCond("gte")?.val as Date).getTime();
    const to = (findCond("lte")?.val as Date).getTime();
    expect(to - from).toBe(6 * 60 * 60 * 1000);
  });

  it("league repassada → eq(league, ...)", async () => {
    await getUpcomingMatches({ league: "brasileirao_a" });
    const cond = findCond("eq");
    expect(cond?.col).toBe(matches.league);
    expect(cond?.val).toBe("brasileirao_a");
  });

  it("retorna as rows stubadas", async () => {
    const rows = [{ id: "u1" }];
    h.state.rows = rows;
    await expect(getUpcomingMatches()).resolves.toEqual(rows);
  });
});
