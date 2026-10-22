import { describe, expect, it } from "vitest";

import {
  buildMatchJudgmentInput,
  teamSchedule,
  teamTopScorerNames,
  type MatchJudgmentData,
} from "@/lib/ai/engine/judgment-input";
import { buildJudgmentState } from "@/lib/ai/judgments/state";
import type {
  NormalizedFixture,
  NormalizedInjury,
  NormalizedTopScorer,
  UpcomingTeamFixture,
} from "@/lib/providers/sports-data/types";

// Domingo 16h UTC; jogo do Brasileirão Flamengo x Palmeiras.
const KICKOFF = new Date("2026-10-25T16:00:00Z");
const HOUR = 3_600_000;
const at = (h: number) => new Date(KICKOFF.getTime() + h * HOUR);

function finished(kickoff: Date, home: string, away: string): NormalizedFixture {
  return {
    id: `brasileirao_a:${kickoff.toISOString()}:${home}:${away}`,
    league: "brasileirao_a",
    kickoffAt: kickoff.toISOString(),
    kickoffTimestampMs: kickoff.getTime(),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: 1, away: 0 },
  };
}

function upcoming(
  kickoff: Date,
  home: string,
  away: string,
  competition = "Serie A",
  round?: string,
): UpcomingTeamFixture {
  return {
    kickoffAt: kickoff.toISOString(),
    kickoffTimestampMs: kickoff.getTime(),
    homeTeam: home,
    awayTeam: away,
    competition,
    ...(round ? { round } : {}),
  };
}

const match = {
  kickoffMs: KICKOFF.getTime(),
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
};

describe("teamSchedule (#617)", () => {
  it("próximo jogo é o 1º depois do kickoff, com competição e fase", () => {
    const s = teamSchedule({
      ...match,
      form: [finished(at(-7 * 24), "Flamengo", "Bahia")],
      upcoming: [
        upcoming(KICKOFF, "Flamengo", "Palmeiras"),
        upcoming(at(76), "Flamengo", "Racing Club", "CONMEBOL Libertadores", "Semi-finals"),
        upcoming(at(52), "Racing Club", "Flamengo", "CONMEBOL Libertadores", "Semi-finals"),
      ],
    });
    expect(s.nextFixture).toEqual({
      kickoffAt: at(52).toISOString(),
      competition: "CONMEBOL Libertadores",
      round: "Semi-finals",
    });
    expect(s.previousKickoffAt).toBe(at(-7 * 24).toISOString());
  });

  it("este jogo com kickoff divergente entre API e banco não conta como anterior nem próximo", () => {
    for (const drift of [-3, +2]) {
      const s = teamSchedule({
        ...match,
        form: [finished(at(-6 * 24), "Flamengo", "Bahia")],
        upcoming: [upcoming(at(drift), "Flamengo", "Palmeiras")],
      });
      expect(s.nextFixture).toBeUndefined();
      expect(s.previousKickoffAt).toBe(at(-6 * 24).toISOString());
    }
  });

  it("jogo de meio de semana ainda não disputado conta como o anterior (descanso curto)", () => {
    const s = teamSchedule({
      ...match,
      form: [finished(at(-7 * 24), "Flamengo", "Bahia")],
      upcoming: [
        upcoming(at(-68), "Flamengo", "Vasco", "Copa Do Brasil", "Semi-finals"),
        upcoming(KICKOFF, "Flamengo", "Palmeiras"),
      ],
    });
    expect(s.previousKickoffAt).toBe(at(-68).toISOString());
  });

  it("sem próximos jogos: só a forma, como antes", () => {
    const s = teamSchedule({
      ...match,
      form: [finished(at(-4 * 24), "Flamengo", "Bahia")],
      upcoming: undefined,
    });
    expect(s).toEqual({ previousKickoffAt: at(-4 * 24).toISOString() });
  });
});

describe("teamTopScorerNames (#617)", () => {
  const rows: NormalizedTopScorer[] = [
    { player: { name: "P. Atacante" }, team: "Flamengo", goals: 12 },
    { player: { name: "B. Meia" }, team: "Flamengo", goals: 7 },
    { player: { name: "C. Centroavante" }, team: "Palmeiras", goals: 9 },
    { player: { name: "D. Ponta" }, team: "Palmeiras", goals: 9 },
    { player: { name: "E. Reserva" }, team: "Bahia", goals: 2 },
  ];

  it("quem tem mais gols pelo time; empate leva os dois", () => {
    expect(teamTopScorerNames(rows, "Flamengo")).toEqual(["P. Atacante"]);
    expect(teamTopScorerNames(rows, "Palmeiras")).toEqual([
      "C. Centroavante",
      "D. Ponta",
    ]);
  });

  it("abaixo do piso de gols, fora da lista ou sem lista: ninguém", () => {
    expect(teamTopScorerNames(rows, "Bahia")).toEqual([]);
    expect(teamTopScorerNames(rows, "Vasco")).toEqual([]);
    expect(teamTopScorerNames(undefined, "Flamengo")).toEqual([]);
  });
});

describe("buildMatchJudgmentInput com calendário e artilheiros (#617)", () => {
  const injury = (name: string): NormalizedInjury => ({
    player: { name },
    type: "injury",
    status: "injured",
  });

  const base: MatchJudgmentData = {
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    injuries: { home: [injury("P. Atacante")], away: [] },
    lineups: undefined,
    homeForm: [finished(at(-7 * 24), "Flamengo", "Bahia")],
    awayForm: [finished(at(-7 * 24), "Palmeiras", "Vasco")],
    standings: undefined,
  };

  it("next_match preenchido e artilheiro marcado; o state não carrega nome", () => {
    const { stateInput } = buildMatchJudgmentInput({
      ...base,
      upcoming: {
        home: [
          upcoming(KICKOFF, "Flamengo", "Palmeiras"),
          upcoming(at(52), "Racing Club", "Flamengo", "CONMEBOL Libertadores", "Semi-finals"),
        ],
      },
      topScorers: [{ player: { name: "P. Atacante" }, team: "Flamengo", goals: 12 }],
    });
    const state = buildJudgmentState(stateInput);
    expect(state.home_team.next_match).toBe(
      "next match within 72h (CONMEBOL Libertadores, knockout)",
    );
    expect(state.away_team.next_match).toBe("unknown");
    expect(state.home_team.absences).toEqual(["player, team top scorer (injured)"]);
    expect(JSON.stringify(state)).not.toContain("Atacante");
  });

  it("sem os dados novos o state sai igual ao de antes (v1)", () => {
    const state = buildJudgmentState(buildMatchJudgmentInput(base).stateInput);
    expect(state.home_team.next_match).toBe("unknown");
    expect(state.home_team.absences).toEqual(["player (injured)"]);
    expect(state.home_team.rest_before_match).toBe("normal rest");
  });
});
