import { describe, expect, it } from "vitest";

import { compositeFixtureKey, type NormalizedFixture } from "@/lib/providers/sports-data/types";
import { SUPERSEDED_KEY_PREFIX } from "@/lib/db/queries/matches";
import {
  planRescheduledFixtures,
  RESCHEDULE_MAX_SHIFT_MS,
  type RescheduleRow,
} from "@/lib/sync/rescheduled-fixtures";

// Jogo remarcado (Bahia x São Paulo, 2026-10-28: 21:00Z → 00:30Z do dia seguinte).
const OLD = "2026-10-28T21:00:00.000Z";
const NEW = "2026-10-29T00:30:00.000Z";

function fixture(kickoffAt: string, over: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    id: "x",
    league: "brasileirao_a",
    kickoffAt,
    kickoffTimestampMs: Date.parse(kickoffAt),
    homeTeam: "EC Bahia",
    awayTeam: "São Paulo FC",
    status: "scheduled",
    score: { home: null, away: null },
    ...over,
  };
}

function row(
  id: string,
  f: NormalizedFixture,
  status: RescheduleRow["status"] = "scheduled",
  hasUserData = false,
): RescheduleRow {
  return {
    hasUserData,
    id,
    externalId: compositeFixtureKey(f),
    league: f.league,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    kickoffAt: new Date(f.kickoffTimestampMs),
    status,
  };
}

describe("planRescheduledFixtures", () => {
  it("row com o horário velho herda a chave e o horário novos", () => {
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(NEW)]);
    expect(plan).toEqual({
      retire: [],
      rekey: [
        {
          id: "a",
          fromKey: compositeFixtureKey(fixture(OLD)),
          externalId: compositeFixtureKey(fixture(NEW)),
          kickoffAt: new Date(NEW),
        },
      ],
      supersede: [],
    });
  });

  it("row nova já existe e nenhuma tem dados: a velha é aposentada", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD)), row("new", fixture(NEW))],
      [fixture(NEW)],
    );
    expect(plan.retire).toEqual([]);
    expect(plan.rekey).toEqual([]);
    expect(plan.supersede).toEqual([
      { id: "old", externalId: compositeFixtureKey(fixture(OLD)), hasUserData: false },
    ]);
  });

  it("row nova vazia já encerrada e a velha tem dados: a velha herda (e liquida pelo upsert)", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD), "scheduled", true), row("new", fixture(NEW), "finished")],
      [fixture(NEW, { status: "finished" })],
    );
    expect(plan.retire.map((r) => r.id)).toEqual(["new"]);
    expect(plan.rekey.map((r) => r.id)).toEqual(["old"]);
    expect(plan.supersede).toEqual([]);
  });

  it("row nova já existe vazia e a velha tem dados: a nova é aposentada e a velha herda", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD), "scheduled", true), row("new", fixture(NEW))],
      [fixture(NEW)],
    );
    expect(plan.retire).toEqual([
      { id: "new", externalId: compositeFixtureKey(fixture(NEW)) },
    ]);
    expect(plan.rekey.map((r) => [r.id, r.externalId])).toEqual([
      ["old", compositeFixtureKey(fixture(NEW))],
    ]);
    expect(plan.supersede).toEqual([]);
  });

  it("as duas têm dados: fica a nova, a velha é aposentada (não junta)", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD), "scheduled", true), row("new", fixture(NEW), "scheduled", true)],
      [fixture(NEW)],
    );
    expect(plan.retire).toEqual([]);
    expect(plan.rekey).toEqual([]);
    expect(plan.supersede.map((s) => s.id)).toEqual(["old"]);
  });

  it("row já aposentada nunca entra de novo", () => {
    const retired = {
      ...row("old", fixture(OLD), "postponed"),
      externalId: `${SUPERSEDED_KEY_PREFIX}old:x`,
    };
    const plan = planRescheduledFixtures([retired, row("new", fixture(NEW))], [fixture(NEW)]);
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("row antes de orphanSince não é candidata", () => {
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(NEW)], {
      orphanSince: new Date(NEW),
    });
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("adiado no provider e depois remarcado: a row adiada volta com a data nova", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD), "postponed")],
      [fixture("2026-11-12T22:00:00.000Z")],
    );
    expect(plan.rekey.map((r) => r.id)).toEqual(["a"]);
    expect(plan.supersede).toEqual([]);
  });

  it("duas cópias velhas sem dados: a mais próxima do horário novo herda, a outra é aposentada", () => {
    const older = fixture("2026-10-28T19:00:00.000Z");
    const plan = planRescheduledFixtures(
      [row("far", older), row("near", fixture(OLD))],
      [fixture(NEW)],
    );
    expect(plan.rekey.map((r) => r.id)).toEqual(["near"]);
    expect(plan.supersede.map((s) => s.id)).toEqual(["far"]);
  });

  it("duas cópias velhas: a que tem dados herda, mesmo mais longe", () => {
    const older = fixture("2026-10-28T19:00:00.000Z");
    const plan = planRescheduledFixtures(
      [row("far", older, "scheduled", true), row("near", fixture(OLD))],
      [fixture(NEW)],
    );
    expect(plan.rekey.map((r) => r.id)).toEqual(["far"]);
    expect(plan.supersede.map((s) => s.id)).toEqual(["near"]);
  });

  it("chave presente no provider: nada muda", () => {
    const plan = planRescheduledFixtures([row("a", fixture(NEW))], [fixture(NEW)]);
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("encerrado ou cancelado nunca é mexido", () => {
    for (const status of ["finished", "cancelled"] as const) {
      const plan = planRescheduledFixtures([row("a", fixture(OLD), status)], [fixture(NEW)]);
      expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
    }
  });

  it("sem o confronto no provider (buraco do provider): nada muda", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { homeTeam: "SE Palmeiras" })],
    );
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("mando invertido é outro jogo (returno)", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { homeTeam: "São Paulo FC", awayTeam: "EC Bahia" })],
    );
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("outra liga com o mesmo confronto não casa", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { league: "copa_libertadores" })],
    );
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("mesmo confronto longe demais no calendário não casa", () => {
    const far = new Date(Date.parse(OLD) + RESCHEDULE_MAX_SHIFT_MS + 60_000).toISOString();
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(far)]);
    expect(plan).toEqual({ retire: [], rekey: [], supersede: [] });
  });

  it("casa com o horário mais próximo quando o confronto aparece duas vezes", () => {
    const near = "2026-10-29T00:30:00.000Z";
    const far = "2026-12-01T00:30:00.000Z";
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(far), fixture(near)]);
    expect(plan.rekey.map((r) => r.externalId)).toEqual([compositeFixtureKey(fixture(near))]);
  });
});
