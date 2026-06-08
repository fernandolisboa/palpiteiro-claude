import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: o factory do vi.mock é içado pro topo do arquivo, então qualquer
// estado/spy que ele referencia precisa ser criado via vi.hoisted (também
// içado). Espelha o padrão de chain-stub de odds-snapshots/ai-config.test.ts.
const h = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    selectCallIndex: 0,
    whereArgs: [] as unknown[],
    orderByArg: undefined as unknown,
    listResult: [] as unknown[],
  };
  return {
    state,
    batchMock: vi.fn((_statements: unknown[]) => Promise.resolve([])),
    updateSetWhere: vi.fn((_cond: unknown) => {}),
    deleteWhere: vi.fn((_cond: unknown) => {}),
    insertOnConflictDoUpdate: vi.fn(() => Promise.resolve()),
    insertValues: vi.fn((_values: { email: string }) => {}),
  };
});

// Stub das condições do drizzle: eq/and viram objetos inspecionáveis, então o
// que o .where() captura carrega o valor (lowercased) literalmente — sem depender
// da serialização opaca do SQL real do drizzle.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  desc: (col: unknown) => ({ op: "desc", col }),
}));

// Stub do db: select().from().where().limit() resolve a próxima entrada de
// selectResults (em ordem). isEmailWhitelistedInDb faz dois selects (users-allowed
// e depois pending_invites), então a ordem distingue os lookups. Não toca Postgres.
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((cond: unknown) => {
        h.state.whereArgs.push(cond);
        return {
          limit: vi.fn(() => {
            const rows = h.state.selectResults[h.state.selectCallIndex] ?? [];
            h.state.selectCallIndex++;
            return Promise.resolve(rows);
          }),
        };
      }),
      orderBy: vi.fn((order: unknown) => {
        h.state.orderByArg = order;
        return Promise.resolve(h.state.listResult ?? []);
      }),
    })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn((cond: unknown) => {
        h.updateSetWhere(cond);
        return { kind: "update", cond, set: values };
      }),
    })),
  }));
  const del = vi.fn(() => ({
    where: vi.fn((cond: unknown) => {
      h.state.whereArgs.push(cond);
      h.deleteWhere(cond);
      return { kind: "delete", cond };
    }),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn((values: { email: string }) => {
      h.insertValues(values);
      return { onConflictDoUpdate: h.insertOnConflictDoUpdate };
    }),
  }));
  return { db: { select, update, delete: del, insert, batch: h.batchMock } };
});

import {
  addPendingInvite,
  isEmailWhitelistedInDb,
  listPendingInvites,
  promoteInvitedUserOnLogin,
  removePendingInvite,
} from "@/lib/db/queries/invites";

const {
  batchMock,
  updateSetWhere,
  deleteWhere,
  insertOnConflictDoUpdate,
  insertValues,
} = h;

// Coleta todos os valores `val` capturados pelos eq() dentro dos where()s.
function capturedEqValues(): unknown[] {
  const values: unknown[] = [];
  const walk = (cond: unknown) => {
    if (!cond || typeof cond !== "object") return;
    const c = cond as { op?: string; val?: unknown; conds?: unknown[] };
    if (c.op === "eq") values.push(c.val);
    if (c.op === "and" && Array.isArray(c.conds)) c.conds.forEach(walk);
  };
  h.state.whereArgs.forEach(walk);
  return values;
}

beforeEach(() => {
  h.state.selectResults = [];
  h.state.selectCallIndex = 0;
  h.state.whereArgs.length = 0;
  h.state.orderByArg = undefined;
  h.state.listResult = [];
  batchMock.mockClear();
  updateSetWhere.mockClear();
  deleteWhere.mockClear();
  insertOnConflictDoUpdate.mockClear();
  insertValues.mockClear();
});

describe("isEmailWhitelistedInDb — users.allowed OR pending_invites", () => {
  it("true quando o lookup de users-allowed retorna uma row", async () => {
    h.state.selectResults = [[{ allowed: true }]]; // primeiro select casa
    await expect(isEmailWhitelistedInDb("a@b.com")).resolves.toBe(true);
    // segundo select nem roda (short-circuit no users-allowed)
    expect(h.state.selectCallIndex).toBe(1);
  });

  it("true quando pending_invites casa (users-allowed vazio)", async () => {
    h.state.selectResults = [[], [{ email: "a@b.com" }]];
    await expect(isEmailWhitelistedInDb("a@b.com")).resolves.toBe(true);
    expect(h.state.selectCallIndex).toBe(2);
  });

  it("false quando nenhum dos dois casa", async () => {
    h.state.selectResults = [[], []];
    await expect(isEmailWhitelistedInDb("a@b.com")).resolves.toBe(false);
    expect(h.state.selectCallIndex).toBe(2);
  });

  it("normaliza o e-mail (input '  A@B.COM ' → 'a@b.com' no eq)", async () => {
    h.state.selectResults = [[{ allowed: true }]];
    await isEmailWhitelistedInDb("  A@B.COM ");
    const vals = capturedEqValues();
    expect(vals).toContain("a@b.com");
    expect(vals).not.toContain("  A@B.COM ");
    expect(vals).not.toContain("A@B.COM");
  });
});

describe("promoteInvitedUserOnLogin — allowed=true + delete no mesmo batch", () => {
  it("com e-mail: db.batch chamado 1x com array de 2 statements (update + delete)", async () => {
    await promoteInvitedUserOnLogin({ id: "u1", email: "a@b.com" });
    expect(batchMock).toHaveBeenCalledTimes(1);
    const arg = batchMock.mock.calls[0]![0] as Array<{
      kind: string;
      set?: unknown;
    }>;
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toHaveLength(2);
    // o batch contém AMBOS: o update (allowed=true) E o delete (do convite),
    // atômicos no mesmo round-trip.
    const kinds = arg.map((s) => s.kind);
    expect(kinds).toContain("update");
    expect(kinds).toContain("delete");
    // o update efetivamente seta allowed=true (não false) — sem isto o teste
    // não distinguiria set({ allowed: true }) de set({ allowed: false }).
    const updateStmt = arg.find((s) => s.kind === "update");
    expect(updateStmt?.set).toEqual({ allowed: true });
    // o delete usa o e-mail normalizado
    expect(capturedEqValues()).toContain("a@b.com");
  });

  it("sem e-mail: só update allowed=true (sem batch, sem delete)", async () => {
    await promoteInvitedUserOnLogin({ id: "u1", email: null });
    expect(batchMock).not.toHaveBeenCalled();
    expect(updateSetWhere).toHaveBeenCalledTimes(1);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("sem id: no-op (guarda contra o caso impossível)", async () => {
    await promoteInvitedUserOnLogin({ id: undefined, email: "a@b.com" });
    expect(batchMock).not.toHaveBeenCalled();
    expect(updateSetWhere).not.toHaveBeenCalled();
  });
});

describe("addPendingInvite — upsert idempotente por e-mail PK", () => {
  it("insert().values().onConflictDoUpdate() com e-mail normalizado", async () => {
    await addPendingInvite({ email: "  A@B.COM ", note: "convite" });
    expect(insertValues).toHaveBeenCalledTimes(1);
    const valuesArg = insertValues.mock.calls[0]![0];
    expect(valuesArg.email).toBe("a@b.com");
    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("removePendingInvite", () => {
  it("delete().where() com e-mail normalizado", async () => {
    await removePendingInvite("  A@B.COM ");
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(capturedEqValues()).toContain("a@b.com");
  });
});

describe("listPendingInvites — convites pendentes, mais recentes primeiro", () => {
  it("retorna as rows da query stubada", async () => {
    const rows = [
      {
        email: "a@b.com",
        note: null,
        invitedByUserId: "u1",
        createdAt: new Date(),
      },
      {
        email: "c@d.com",
        note: "amigo",
        invitedByUserId: null,
        createdAt: new Date(),
      },
    ];
    h.state.listResult = rows;
    await expect(listPendingInvites()).resolves.toEqual(rows);
  });

  it("ordena por createdAt DESC (orderBy recebe um desc())", async () => {
    h.state.listResult = [];
    await listPendingInvites();
    const order = h.state.orderByArg as { op?: string } | undefined;
    expect(order?.op).toBe("desc");
  });
});
