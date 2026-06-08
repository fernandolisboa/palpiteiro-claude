import { beforeEach, describe, expect, it, vi } from "vitest";

// Chain-stub no estilo de invites/odds-snapshots.test.ts. O construtor da query
// (select().from()...orderBy()) é um objeto encadeável que registra cada arg em
// estado hoisted e é ele mesmo thenable, resolvendo as rows configuradas. Assim
// tanto a query de summary (termina em .from) quanto as agregações (terminam em
// .orderBy) resolvem. Nenhum Postgres é tocado.
const h = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectCols: undefined as unknown,
    whereArg: undefined as unknown,
    innerJoinArgs: [] as unknown[],
    groupByArgs: [] as unknown[],
    orderByArg: undefined as unknown,
  };
  return { state };
});

// Stub das funções do drizzle como objetos inspecionáveis. `sql` é usado como
// template tag E como `sql<T>\`...\`.as(name)`, então o retorno expõe `.as()`.
vi.mock("drizzle-orm", () => {
  const sql = Object.assign(
    (strings: unknown, ...vals: unknown[]) => ({
      op: "sql",
      strings,
      vals,
      as: (name: string) => ({ op: "sql-as", name }),
    }),
    { raw: (s: unknown) => ({ op: "sql-raw", s }) },
  );
  return {
    sum: (col: unknown) => ({ op: "sum", col }),
    count: () => ({ op: "count" }),
    eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
    gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
    desc: (x: unknown) => ({ op: "desc", x }),
    sql,
  };
});

vi.mock("@/lib/db", () => {
  // O mesmo objeto encadeável é retornado por cada método e é thenable, então
  // `await db.select()...<qualquer terminal>` resolve h.state.rows.
  const chain: Record<string, unknown> = {};
  const record = (key: keyof typeof h.state, value: unknown) => {
    (h.state[key] as unknown) = value;
    return chain;
  };
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn((arg: unknown) => record("whereArg", arg));
  chain.innerJoin = vi.fn((table: unknown, cond: unknown) => {
    h.state.innerJoinArgs.push(table, cond);
    return chain;
  });
  chain.groupBy = vi.fn((...args: unknown[]) => {
    h.state.groupByArgs.push(...args);
    return chain;
  });
  chain.orderBy = vi.fn((arg: unknown) => record("orderByArg", arg));
  chain.then = (resolve: (rows: unknown[]) => unknown) =>
    resolve(h.state.rows);
  const select = vi.fn((cols: unknown) => {
    h.state.selectCols = cols;
    return chain;
  });
  return { db: { select } };
});

// Schema real (NÃO mockado): trava identidade de coluna (groupBy em
// aiCalls.model vs aiCalls.userId é uma checagem exata, como em invites.test.ts).
import { aiCalls, users } from "@/db/schema";
import {
  getCostByDay,
  getCostByModel,
  getCostByUser,
  getCostSummary,
} from "@/lib/db/queries/ai-costs";

beforeEach(() => {
  h.state.rows = [];
  h.state.selectCols = undefined;
  h.state.whereArg = undefined;
  h.state.innerJoinArgs = [];
  h.state.groupByArgs = [];
  h.state.orderByArg = undefined;
});

// Extrai o operando Date interpolado num `sum(sql`...`)` capturado em selectCols
// (o stub de `sql` registra os `vals`; o operando de data é o único Date entre eles).
function dateOperandOf(selectCol: unknown): Date | undefined {
  const col = (selectCol as { col?: { vals?: unknown[] } })?.col;
  return col?.vals?.find((v): v is Date => v instanceof Date);
}

// Coleta recursiva de todos os `op:"eq"` capturados numa condição (where/join).
function collectEqs(cond: unknown): Array<{ a: unknown; b: unknown }> {
  const out: Array<{ a: unknown; b: unknown }> = [];
  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const o = c as { op?: string; a?: unknown; b?: unknown; conds?: unknown[] };
    if (o.op === "eq") out.push({ a: o.a, b: o.b });
    if (Array.isArray(o.conds)) o.conds.forEach(walk);
  };
  walk(cond);
  return out;
}

describe("getCostSummary — KPIs + conversão numeric-as-string", () => {
  it("converte cada SUM string→Number na fronteira (gotcha load-bearing)", async () => {
    h.state.rows = [
      {
        totalUsd: "1.234567",
        todayUsd: "0.50",
        last7dUsd: "1.10",
        totalCalls: 3,
      },
    ];
    const out = await getCostSummary();
    expect(out.totalUsd).toBe(1.234567);
    expect(out.todayUsd).toBe(0.5);
    expect(out.last7dUsd).toBe(1.1);
    expect(out.totalCalls).toBe(3);
    // Tipos reais, não strings.
    expect(typeof out.totalUsd).toBe("number");
    expect(typeof out.todayUsd).toBe("number");
  });

  it("zero-row: SUM null → 0 (nunca null/NaN)", async () => {
    h.state.rows = [
      { totalUsd: null, todayUsd: null, last7dUsd: null, totalCalls: 0 },
    ];
    const out = await getCostSummary();
    expect(out.totalUsd).toBe(0);
    expect(out.todayUsd).toBe(0);
    expect(out.last7dUsd).toBe(0);
    expect(out.totalCalls).toBe(0);
    expect(Number.isNaN(out.totalUsd)).toBe(false);
  });

  it("NÃO filtra por status — todas as rows são cobradas", async () => {
    h.state.rows = [
      { totalUsd: "0", todayUsd: "0", last7dUsd: "0", totalCalls: 0 },
    ];
    await getCostSummary();
    // Não há .where() com um eq na coluna de status (summary soma tudo).
    const eqs = collectEqs(h.state.whereArg);
    const hasStatusEq = eqs.some(
      (e) => e.a === aiCalls.status || e.b === aiCalls.status,
    );
    expect(hasStatusEq).toBe(false);
    expect(h.state.whereArg).toBeUndefined();
  });

  it("ancora 'hoje' no início do dia UTC e 'últimos 7d' em -6 dias (boundary)", async () => {
    h.state.rows = [
      { totalUsd: "0", todayUsd: "0", last7dUsd: "0", totalCalls: 0 },
    ];
    // 03:00Z do dia 08 → o limite de hoje é o início do dia UTC (08, 00:00Z),
    // não a hora atual; os últimos 7d incluem hoje, logo começam no dia 02.
    await getCostSummary(new Date("2026-06-08T03:00:00Z"));
    const cols = h.state.selectCols as Record<string, unknown>;
    expect(dateOperandOf(cols.todayUsd)?.getTime()).toBe(Date.UTC(2026, 5, 8));
    expect(dateOperandOf(cols.last7dUsd)?.getTime()).toBe(Date.UTC(2026, 5, 2));
  });
});

describe("getCostByDay — agrupado por dia UTC, recente primeiro", () => {
  it("groupBy no dia, orderBy desc no mesmo, where gte em createdAt", async () => {
    h.state.rows = [{ day: "2026-06-08", totalUsd: "2.5", calls: 4 }];
    const out = await getCostByDay(30);

    // groupBy recebeu a expressão de dia (sql-as "day").
    const dayGroup = h.state.groupByArgs.find(
      (g) => (g as { op?: string }).op === "sql-as",
    ) as { name?: string } | undefined;
    expect(dayGroup?.name).toBe("day");

    // orderBy é desc envolvendo a expressão de dia.
    const order = h.state.orderByArg as { op?: string; x?: { op?: string } };
    expect(order?.op).toBe("desc");
    expect(order?.x?.op).toBe("sql-as");

    // where filtra createdAt via gte.
    const where = h.state.whereArg as {
      op?: string;
      col?: unknown;
      val?: unknown;
    };
    expect(where?.op).toBe("gte");
    expect(where?.col).toBe(aiCalls.createdAt);
    expect(where?.val).toBeInstanceOf(Date);

    // Mapeia totalUsd string→Number.
    expect(out[0]!.totalUsd).toBe(2.5);
    expect(out[0]!.calls).toBe(4);
    expect(out[0]!.day).toBe("2026-06-08");
  });

  it("janela = início do dia UTC menos (days-1) — sem off-by-one", async () => {
    const now = new Date("2026-06-08T03:00:00Z");

    // days=1 → só hoje: cutoff é o início do dia UTC corrente.
    await getCostByDay(1, now);
    expect((h.state.whereArg as { val?: Date }).val?.getTime()).toBe(
      Date.UTC(2026, 5, 8),
    );

    // days=7 → hoje + 6 dias anteriores: cutoff no dia 02.
    await getCostByDay(7, now);
    expect((h.state.whereArg as { val?: Date }).val?.getTime()).toBe(
      Date.UTC(2026, 5, 2),
    );
  });
});

describe("getCostByUser — join users, ordenado por gasto desc", () => {
  it("innerJoin users on aiCalls.userId=users.id, groupBy userId, orderBy desc(sum)", async () => {
    h.state.rows = [
      { userId: "u1", email: "a@b.com", totalUsd: "5.0", calls: 10 },
    ];
    const out = await getCostByUser();

    // innerJoin com a tabela users e a condição de FK.
    expect(h.state.innerJoinArgs[0]).toBe(users);
    const joinEqs = collectEqs(h.state.innerJoinArgs[1]);
    const fkJoin = joinEqs.some(
      (e) =>
        (e.a === aiCalls.userId && e.b === users.id) ||
        (e.a === users.id && e.b === aiCalls.userId),
    );
    expect(fkJoin).toBe(true);

    // groupBy inclui aiCalls.userId.
    expect(h.state.groupByArgs).toContain(aiCalls.userId);

    // orderBy desc(sum(costUsd)).
    const order = h.state.orderByArg as {
      op?: string;
      x?: { op?: string; col?: unknown };
    };
    expect(order?.op).toBe("desc");
    expect(order?.x?.op).toBe("sum");
    expect(order?.x?.col).toBe(aiCalls.costUsd);

    // email vem do join, totalUsd convertido.
    expect(out[0]!.email).toBe("a@b.com");
    expect(out[0]!.totalUsd).toBe(5);
    expect(out[0]!.userId).toBe("u1");
  });
});

describe("getCostByModel — agrupado pelo modelo certo, gasto desc", () => {
  it("groupBy em aiCalls.model (não userId) e orderBy desc(sum)", async () => {
    h.state.rows = [{ model: "claude-opus-4-8", totalUsd: "3.25", calls: 7 }];
    const out = await getCostByModel();

    // A COLUNA importa: agrupar por userId aqui seria um bug silencioso.
    expect(h.state.groupByArgs).toContain(aiCalls.model);
    expect(h.state.groupByArgs).not.toContain(aiCalls.userId);

    const order = h.state.orderByArg as {
      op?: string;
      x?: { op?: string; col?: unknown };
    };
    expect(order?.op).toBe("desc");
    expect(order?.x?.op).toBe("sum");
    expect(order?.x?.col).toBe(aiCalls.costUsd);

    expect(out[0]!.model).toBe("claude-opus-4-8");
    expect(out[0]!.totalUsd).toBe(3.25);
    expect(out[0]!.calls).toBe(7);
  });
});
