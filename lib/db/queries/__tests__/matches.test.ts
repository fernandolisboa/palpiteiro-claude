import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: o factory do vi.mock é içado pro topo, então o estado que ele
// referencia precisa ser criado via vi.hoisted (também içado). Espelha o
// chain-stub de odds-snapshots.test.ts / users.test.ts.
const h = vi.hoisted(() => {
  type Call = {
    whereArg: unknown;
    orderByArg: unknown;
    limitArg: unknown;
    limitCalled: boolean;
  };
  const state = {
    whereArg: undefined as unknown,
    orderByArg: undefined as unknown,
    limitArg: undefined as unknown,
    limitCalled: false,
    rows: [] as unknown[],
    // Cada select().from().where().orderBy() registra uma entrada aqui (na ordem
    // de chamada). getMatchesInRange faz 1 select; getMatchesByTeam faz 2 (past,
    // future) — calls[0]/calls[1]. whereArg/orderByArg/limitArg apontam pro ÚLTIMO
    // (compat: os testes de 1 select leem o singleton).
    calls: [] as Call[],
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
  or: (...conds: unknown[]) => {
    const filtered = conds.filter((c) => c !== undefined);
    return filtered.length ? { op: "or", conds: filtered } : undefined;
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
  lt: (col: unknown, val: unknown) => ({ op: "lt", col, val }),
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
  // Cada select() abre uma NOVA entrada em h.state.calls e propaga os ponteiros
  // singleton (whereArg/orderByArg/limitArg) pro ÚLTIMO valor capturado — assim os
  // testes de 1 select seguem lendo o singleton, e os de 2 selects (getMatchesByTeam)
  // leem calls[0]/calls[1].
  const makeChain = () => {
    const call = {
      whereArg: undefined as unknown,
      orderByArg: undefined as unknown,
      limitArg: undefined as unknown,
      limitCalled: false,
    };
    h.state.calls.push(call);
    const makeOrderByResult = () => ({
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(h.state.rows).then(resolve),
      limit: vi.fn((n: unknown) => {
        call.limitCalled = true;
        call.limitArg = n;
        h.state.limitCalled = true;
        h.state.limitArg = n;
        return Promise.resolve(h.state.rows);
      }),
    });
    return {
      where: vi.fn((cond: unknown) => {
        call.whereArg = cond;
        h.state.whereArg = cond;
        return {
          orderBy: vi.fn((order: unknown) => {
            call.orderByArg = order;
            h.state.orderByArg = order;
            return makeOrderByResult();
          }),
        };
      }),
    };
  };
  const select = vi.fn(() => ({ from: vi.fn(() => makeChain()) }));
  return { db: { select } };
});

import { matches } from "@/db/schema";
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
import {
  getMatchesByTeam,
  getMatchesInRange,
  getUpcomingMatches,
} from "@/lib/db/queries/matches";

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
  h.state.calls = [];
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

  it("leagues → inArray(league, [...]) (aba 'Todos' = ligas ativas, #491)", async () => {
    await getMatchesInRange({
      from: null,
      to: null,
      leagues: ["brasileirao_a", "champions_league"],
    });

    const cond = findCond("inArray");
    expect(cond?.col).toBe(matches.league);
    expect(cond?.val).toEqual(["brasileirao_a", "champions_league"]);
  });

  it("leagues vazio → NÃO aplica filtro de liga", async () => {
    await getMatchesInRange({ from: null, to: null, leagues: [] });
    expect(h.state.whereArg).toBeUndefined();
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
  it("from=now-IN_PROGRESS_WINDOW_MS, to=now+window, statuses [scheduled,live], asc, sem limit", async () => {
    const before = Date.now();
    await getUpcomingMatches();
    const after = Date.now();

    const gte = findCond("gte");
    const lte = findCond("lte");
    const from = gte?.val as Date;
    const to = lte?.val as Date;

    // from ≈ now - IN_PROGRESS_WINDOW_MS (#418): o bound inferior recua a janela
    // in-progress pra não dropar o jogo recém-apitado (DB-`scheduled` stale).
    expect(from.getTime()).toBeGreaterThanOrEqual(before - IN_PROGRESS_WINDOW_MS);
    expect(from.getTime()).toBeLessThanOrEqual(after - IN_PROGRESS_WINDOW_MS);

    // janela default = 48h À FRENTE de now (to ≈ now+48h), independente do recuo do from
    expect(to.getTime()).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000);
    expect(to.getTime()).toBeLessThanOrEqual(after + 48 * 60 * 60 * 1000);

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

  it("recuo do bound inferior = exatamente IN_PROGRESS_WINDOW_MS antes da janela à frente (#418)", async () => {
    await getUpcomingMatches({ windowHours: 6 });
    const from = (findCond("gte")?.val as Date).getTime();
    const to = (findCond("lte")?.val as Date).getTime();
    // span total = recuo (IN_PROGRESS_WINDOW_MS) + janela à frente (windowHours).
    expect(to - from).toBe(IN_PROGRESS_WINDOW_MS + 6 * 60 * 60 * 1000);
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

describe("getMatchesByTeam — histórico do time (2 fatias)", () => {
  // and() do call N: lê whereArg da entrada calls[N] (não o singleton, que só vale
  // p/ 1-select). Devolve as conds do and() externo (que inclui o or() do time).
  function callAndConds(idx: number): Cond[] {
    const where = h.state.calls[idx]?.whereArg as Cond | undefined;
    expect(where?.op).toBe("and");
    return where?.conds ?? [];
  }
  function callFindCond(idx: number, op: string): Cond | undefined {
    return callAndConds(idx).find((c) => c.op === op);
  }

  it("filtro de time = or(eq(homeTeam,team), eq(awayTeam,team)) nas DUAS fatias", async () => {
    await getMatchesByTeam("Brazil");
    for (const idx of [0, 1]) {
      const orCond = callFindCond(idx, "or");
      expect(orCond?.conds).toEqual([
        { op: "eq", col: matches.homeTeam, val: "Brazil" },
        { op: "eq", col: matches.awayTeam, val: "Brazil" },
      ]);
    }
  });

  it("PAST (calls[0]) = kickoff<now + status='finished' + desc + limit 5", async () => {
    const before = Date.now();
    await getMatchesByTeam("Brazil");
    const after = Date.now();

    // kickoff < now via lt(kickoffAt, now)
    const lt = callFindCond(0, "lt");
    expect(lt?.col).toBe(matches.kickoffAt);
    const now = (lt?.val as Date).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);

    // status = 'finished' (eq, não inArray)
    const status = callFindCond(0, "eq");
    expect(status?.col).toBe(matches.status);
    expect(status?.val).toBe("finished");

    // desc kickoffAt + limit default 5
    expect((h.state.calls[0].orderByArg as Cond).op).toBe("desc");
    expect((h.state.calls[0].orderByArg as Cond).col).toBe(matches.kickoffAt);
    expect(h.state.calls[0].limitCalled).toBe(true);
    expect(h.state.calls[0].limitArg).toBe(5);
  });

  it("FUTURE (calls[1]) = kickoff>=now + status IN [scheduled,live] + asc + limit 10", async () => {
    await getMatchesByTeam("Brazil");

    const gte = callFindCond(1, "gte");
    expect(gte?.col).toBe(matches.kickoffAt);

    const status = callFindCond(1, "inArray");
    expect(status?.col).toBe(matches.status);
    expect(status?.val).toEqual(["scheduled", "live"]);

    expect((h.state.calls[1].orderByArg as Cond).op).toBe("asc");
    expect((h.state.calls[1].orderByArg as Cond).col).toBe(matches.kickoffAt);
    expect(h.state.calls[1].limitCalled).toBe(true);
    expect(h.state.calls[1].limitArg).toBe(10);
  });

  it("league opcional → eq(league, ...) nas duas fatias; ausente → sem filtro de liga", async () => {
    await getMatchesByTeam("Brazil", { league: "world_cup" });
    for (const idx of [0, 1]) {
      const leagueCond = callAndConds(idx).find(
        (c) => c.op === "eq" && c.col === matches.league,
      );
      expect(leagueCond?.val).toBe("world_cup");
    }

    h.state.calls = [];
    await getMatchesByTeam("Brazil");
    for (const idx of [0, 1]) {
      const leagueCond = callAndConds(idx).find(
        (c) => c.op === "eq" && c.col === matches.league,
      );
      expect(leagueCond).toBeUndefined();
    }
  });

  it("limits customizados são repassados a cada fatia", async () => {
    await getMatchesByTeam("Brazil", { pastLimit: 3, futureLimit: 7 });
    expect(h.state.calls[0].limitArg).toBe(3);
    expect(h.state.calls[1].limitArg).toBe(7);
  });

  it("retorna { past, future } com as rows stubadas", async () => {
    const rows = [{ id: "t1" }];
    h.state.rows = rows;
    await expect(getMatchesByTeam("Brazil")).resolves.toEqual({
      past: rows,
      future: rows,
    });
  });
});
