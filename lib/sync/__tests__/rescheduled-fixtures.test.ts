import { describe, expect, it } from "vitest";

import { compositeFixtureKey, type NormalizedFixture } from "@/lib/providers/sports-data/types";
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

function row(id: string, f: NormalizedFixture, status: RescheduleRow["status"] = "scheduled"): RescheduleRow {
  return {
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

  it("row nova já existe (sync de antes da correção): a velha é superada", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD)), row("new", fixture(NEW))],
      [fixture(NEW)],
    );
    expect(plan.rekey).toEqual([]);
    expect(plan.supersede).toEqual([
      { id: "old", externalId: compositeFixtureKey(fixture(OLD)) },
    ]);
  });

  it("row velha já adiada e row nova existente: nada a fazer", () => {
    const plan = planRescheduledFixtures(
      [row("old", fixture(OLD), "postponed"), row("new", fixture(NEW))],
      [fixture(NEW)],
    );
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("adiado no provider e depois remarcado: a row adiada volta com a data nova", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD), "postponed")],
      [fixture("2026-11-12T22:00:00.000Z")],
    );
    expect(plan.rekey.map((r) => r.id)).toEqual(["a"]);
    expect(plan.supersede).toEqual([]);
  });

  it("duas cópias velhas: a mais próxima do horário novo herda, a outra é superada", () => {
    const older = fixture("2026-10-28T19:00:00.000Z");
    const plan = planRescheduledFixtures(
      [row("far", older), row("near", fixture(OLD))],
      [fixture(NEW)],
    );
    expect(plan.rekey.map((r) => r.id)).toEqual(["near"]);
    expect(plan.supersede.map((s) => s.id)).toEqual(["far"]);
  });

  it("chave presente no provider: nada muda", () => {
    const plan = planRescheduledFixtures([row("a", fixture(NEW))], [fixture(NEW)]);
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("encerrado ou cancelado nunca é mexido", () => {
    for (const status of ["finished", "cancelled"] as const) {
      const plan = planRescheduledFixtures([row("a", fixture(OLD), status)], [fixture(NEW)]);
      expect(plan).toEqual({ rekey: [], supersede: [] });
    }
  });

  it("sem o confronto no provider (buraco do provider): nada muda", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { homeTeam: "SE Palmeiras" })],
    );
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("mando invertido é outro jogo (returno)", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { homeTeam: "São Paulo FC", awayTeam: "EC Bahia" })],
    );
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("outra liga com o mesmo confronto não casa", () => {
    const plan = planRescheduledFixtures(
      [row("a", fixture(OLD))],
      [fixture(NEW, { league: "copa_libertadores" })],
    );
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("mesmo confronto longe demais no calendário não casa", () => {
    const far = new Date(Date.parse(OLD) + RESCHEDULE_MAX_SHIFT_MS + 60_000).toISOString();
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(far)]);
    expect(plan).toEqual({ rekey: [], supersede: [] });
  });

  it("casa com o horário mais próximo quando o confronto aparece duas vezes", () => {
    const near = "2026-10-29T00:30:00.000Z";
    const far = "2026-12-01T00:30:00.000Z";
    const plan = planRescheduledFixtures([row("a", fixture(OLD))], [fixture(far), fixture(near)]);
    expect(plan.rekey.map((r) => r.externalId)).toEqual([compositeFixtureKey(fixture(near))]);
  });
});
