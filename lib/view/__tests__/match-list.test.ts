import { describe, expect, it } from "vitest";

import type { MatchInput } from "@/lib/view/match";
import { toMatchListRowView } from "@/lib/view/match";
import { groupByDay, matchRowPhase, showsRowLiveBadge } from "@/lib/view/match-list";
import type { MatchListRowView, MatchStatus } from "@/lib/view/types";

// Quinta 15/10/2026, 12:00 em São Paulo (UTC-3, sem horário de verão desde 2019).
const NOW = new Date("2026-10-15T15:00:00.000Z");
const SP = "America/Sao_Paulo";

function match(id: string, kickoffIso: string, status: MatchStatus = "scheduled"): MatchInput {
  return {
    id,
    league: "brasileirao_a",
    homeTeam: "SE Palmeiras",
    awayTeam: "CR Flamengo",
    kickoffAt: new Date(kickoffIso),
    status,
    homeScore: null,
    awayScore: null,
  };
}

function row(id: string, kickoffIso: string, timeZone = SP): MatchListRowView {
  return toMatchListRowView({
    match: match(id, kickoffIso),
    odds: null,
    hasPrediction: false,
    now: NOW,
    timeZone,
  });
}

describe("groupByDay (#577)", () => {
  it("agrupa linhas consecutivas por dia no fuso, preservando a ordem", () => {
    const rows = [
      row("a", "2026-10-15T22:00:00Z"), // 19:00 de hoje
      row("b", "2026-10-16T01:00:00Z"), // 22:00 de hoje em SP (01:00 de amanhã em UTC)
      row("c", "2026-10-16T19:00:00Z"), // amanhã 16:00
      row("d", "2026-10-17T13:00:00Z"), // sábado 10:00
      row("e", "2026-10-17T21:30:00Z"), // sábado 18:30
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.label)).toEqual(["Hoje", "Amanhã", "Sábado 17/10"]);
    expect(groups.map((g) => g.key)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d", "e"],
    ]);
  });

  it("o jogo de 22h em São Paulo fica no dia de São Paulo, não no de UTC", () => {
    const sp = groupByDay([row("b", "2026-10-16T01:00:00Z")]);
    expect(sp[0]).toMatchObject({ key: "2026-10-15", label: "Hoje" });
    const utc = groupByDay([row("b", "2026-10-16T01:00:00Z", "UTC")]);
    expect(utc[0]).toMatchObject({ key: "2026-10-16", label: "Amanhã" });
  });

  it("vira o dia na meia-noite local", () => {
    const groups = groupByDay([
      row("antes", "2026-10-16T02:59:00Z"), // 23:59 de hoje em SP
      row("depois", "2026-10-16T03:00:00Z"), // 00:00 de amanhã em SP
    ]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.time)])).toEqual([
      ["Hoje", ["23:59"]],
      ["Amanhã", ["00:00"]],
    ]);
  });

  it("a mesma chave fora de sequência abre outro grupo (não reordena)", () => {
    const groups = groupByDay([
      row("a", "2026-10-15T22:00:00Z"),
      row("c", "2026-10-16T19:00:00Z"),
      row("a2", "2026-10-15T23:00:00Z"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Hoje", "Amanhã", "Hoje"]);
  });

  it("lista vazia não tem grupo", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("matchRowPhase (#577)", () => {
  const base = { isInProgress: false };
  it("cobre as quatro fases", () => {
    expect(matchRowPhase({ ...base, status: "scheduled" })).toBe("upcoming");
    expect(matchRowPhase({ ...base, status: "live" })).toBe("live");
    expect(matchRowPhase({ ...base, status: "finished" })).toBe("finished");
    expect(matchRowPhase({ ...base, status: "postponed" })).toBe("off");
    expect(matchRowPhase({ ...base, status: "cancelled" })).toBe("off");
  });

  it("jogo ainda `scheduled` que já apitou (isInProgress) é ao vivo", () => {
    expect(matchRowPhase({ status: "scheduled", isInProgress: true })).toBe("live");
  });

  it("vem da view: apitado há 20 minutos e ainda agendado no banco", () => {
    const m = toMatchListRowView({
      match: match("x", new Date(NOW.getTime() - 20 * 60 * 1000).toISOString()),
      odds: null,
      hasPrediction: false,
      now: NOW,
      timeZone: SP,
    });
    expect(matchRowPhase(m)).toBe("live");
  });
});

describe("showsRowLiveBadge (#580)", () => {
  const score = { home: 2, away: 1, caption: "63' · atualizado há 20 s", live: true as const };
  it("jogo rolando: selo; fim pelo provider (sync ainda não virou): sem selo", () => {
    const m = { status: "scheduled" as const, isInProgress: true };
    expect(showsRowLiveBadge(m)).toBe(true);
    expect(showsRowLiveBadge({ ...m, liveScore: { ...score, ended: false } })).toBe(true);
    expect(
      showsRowLiveBadge({ ...m, liveScore: { ...score, caption: "fim de jogo", ended: true } })
    ).toBe(false);
    // O lado direito segue no ramo live (placar + "fim de jogo").
    expect(matchRowPhase(m)).toBe("live");
  });

  it("fora do ao vivo: nunca selo", () => {
    expect(showsRowLiveBadge({ status: "finished", isInProgress: false })).toBe(false);
    expect(showsRowLiveBadge({ status: "scheduled", isInProgress: false })).toBe(false);
  });
});
