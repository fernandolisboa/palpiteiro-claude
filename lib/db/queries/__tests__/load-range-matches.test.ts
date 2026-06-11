import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbMatch } from "@/lib/db/queries/matches";

// Captura o callback passado pro `after()` do Next em vez de executá-lo, pra
// asseverar que `loadRangeMatches` agenda o sync sem aguardá-lo.
const afterCallbacks: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));

vi.mock("@/lib/sync/sync-upcoming-fixtures", () => ({
  ensureUpcomingFixturesSynced: vi.fn(),
}));
vi.mock("@/lib/db/queries/matches", () => ({
  getMatchesInRange: vi.fn(),
}));

import { loadRangeMatches } from "@/lib/db/queries/load-range-matches";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";
import { getMatchesInRange } from "@/lib/db/queries/matches";

const mockSync = vi.mocked(ensureUpcomingFixturesSynced);
const mockQuery = vi.mocked(getMatchesInRange);

const QUERY: Parameters<typeof getMatchesInRange>[0] = {
  from: new Date("2026-06-01"),
  to: new Date("2026-06-30"),
  league: "world_cup",
  statuses: ["scheduled"],
  order: "asc",
  limit: 200,
};

// Linha mínima só pra distinguir array vazio de não-vazio nos asserts.
const ROW = { id: "m1" } as unknown as DbMatch;

beforeEach(() => {
  mockSync.mockReset();
  mockQuery.mockReset();
  afterCallbacks.length = 0;
});

describe("loadRangeMatches", () => {
  it("retorna o resultado da query SEM aguardar o sync (não bloqueia)", async () => {
    mockSync.mockResolvedValue();
    mockQuery.mockResolvedValue([ROW]);

    const result = await loadRangeMatches(QUERY);

    // A query rodou e retornou imediatamente; o sync NÃO foi awaited no caminho
    // do request — só agendado.
    expect(mockQuery).toHaveBeenCalledWith(QUERY);
    expect(result).toEqual([ROW]);
    expect(mockSync).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });

  it("#124: agenda o sync MESMO com DB não-vazio (sem guard length===0)", async () => {
    mockSync.mockResolvedValue();
    mockQuery.mockResolvedValue([ROW]);

    await loadRangeMatches(QUERY);

    // Um callback de sync foi registrado, independente de o DB ter rows.
    expect(afterCallbacks).toHaveLength(1);
    // E ao rodá-lo (pós-resposta), o sync é de fato chamado — sem `force` (no-op
    // enquanto o lock durável está segurado).
    await afterCallbacks[0]();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith();
  });

  it("roda a query e retorna o resultado mesmo quando o DB está vazio", async () => {
    mockSync.mockResolvedValue();
    mockQuery.mockResolvedValue([]);

    const result = await loadRangeMatches(QUERY);

    expect(mockQuery).toHaveBeenCalledWith(QUERY);
    expect(result).toEqual([]);
    expect(afterCallbacks).toHaveLength(1);
  });

  it("uma falha no sync agendado é engolida e NÃO rejeita loadRangeMatches", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSync.mockRejectedValue(new Error("provider down"));
    mockQuery.mockResolvedValue([ROW]);

    // O retorno não rejeita mesmo com o sync fadado a falhar.
    const result = await loadRangeMatches(QUERY);
    expect(result).toEqual([ROW]);

    // Rodar o callback agendado (pós-resposta) engole o erro e loga, sem throw.
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
