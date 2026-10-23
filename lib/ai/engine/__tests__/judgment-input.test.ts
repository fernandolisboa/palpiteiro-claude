import { describe, expect, it } from "vitest";

import {
  buildMatchJudgmentInput,
  pickLineupBaseline,
  teamSchedule,
  teamTopScorerNames,
  type MatchJudgmentData,
} from "@/lib/ai/engine/judgment-input";
import { buildJudgmentState } from "@/lib/ai/judgments/state";
import type {
  NormalizedFixture,
  NormalizedInjury,
  NormalizedTeamLineup,
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

describe("pickLineupBaseline (#619)", () => {
  const DAY = 24;
  const inCompetition = (
    kickoff: Date,
    competition: NormalizedFixture["competition"],
    away = "Bahia"
  ): NormalizedFixture => ({
    ...finished(kickoff, "Flamengo", away),
    ...(competition ? { competition } : {}),
  });
  const LEAGUE = {
    name: "Serie A",
    league: "brasileirao_a" as const,
    friendly: false,
  };
  const LIBERTADORES = {
    name: "CONMEBOL Libertadores",
    league: "copa_libertadores" as const,
    friendly: false,
  };
  const args = {
    league: "brasileirao_a" as const,
    kickoffMs: KICKOFF.getTime(),
  };

  it("o mais recente da mesma competição, não congestionado", () => {
    const recent = inCompetition(at(-7 * DAY), LEAGUE);
    const older = inCompetition(at(-14 * DAY), LEAGUE, "Vasco");
    expect(pickLineupBaseline([older, recent], args)).toBe(recent);
  });

  it("amistoso, forma sem `competition` e outra competição ficam fora", () => {
    expect(
      pickLineupBaseline(
        [
          inCompetition(at(-5 * DAY), {
            name: "Friendlies Clubs",
            league: "brasileirao_a",
            friendly: true,
          }),
          inCompetition(at(-6 * DAY), undefined),
          inCompetition(at(-8 * DAY), LIBERTADORES),
        ],
        args
      )
    ).toBeUndefined();
  });

  it("mais de 45 dias antes do kickoff fica fora; jogo depois do kickoff também", () => {
    expect(
      pickLineupBaseline([inCompetition(at(-46 * DAY), LEAGUE)], args)
    ).toBeUndefined();
    const at45 = inCompetition(at(-45 * DAY), LEAGUE);
    expect(pickLineupBaseline([at45], args)).toBe(at45);
    expect(
      pickLineupBaseline([inCompetition(at(2 * DAY), LEAGUE)], args)
    ).toBeUndefined();
  });

  it("congestionado (jogo de outra competição a < 72 h) perde pro anterior limpo", () => {
    // Liga poupada 2 dias antes da Libertadores: a referência é a liga de 2 semanas.
    const spared = inCompetition(at(-6 * DAY), LEAGUE);
    const cup = inCompetition(at(-4 * DAY), LIBERTADORES, "Racing Club");
    const clean = inCompetition(at(-13 * DAY), LEAGUE, "Vasco");
    expect(pickLineupBaseline([spared, cup, clean], args)).toBe(clean);
  });

  it("congestionado com ESTE jogo (< 72 h antes do kickoff) também perde", () => {
    const midweek = inCompetition(at(-2 * DAY), LEAGUE);
    const clean = inCompetition(at(-9 * DAY), LEAGUE, "Vasco");
    expect(pickLineupBaseline([midweek, clean], args)).toBe(clean);
  });

  it("todos congestionados → undefined (mudanças desconhecidas; o calendário decide)", () => {
    const a = inCompetition(at(-6 * DAY), LEAGUE);
    const b = inCompetition(at(-8 * DAY), LEAGUE, "Vasco");
    expect(pickLineupBaseline([b, a], args)).toBeUndefined();
  });
});

describe("buildMatchJudgmentInput com a escalação deste jogo (#619)", () => {
  const xi = (team: string, ids: readonly number[]): NormalizedTeamLineup => ({
    team,
    starters: ids.map((id, i) => ({
      name: `J${id}`,
      position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 8 ? "MID" : "FWD",
      providerPlayerId: `api-football:${id}`,
    })),
  });
  const ELEVEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const injuredJ10: NormalizedInjury = {
    player: { name: "J10" },
    type: "injury",
    status: "injured",
  };
  const base: MatchJudgmentData = {
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    injuries: { home: [injuredJ10], away: [] },
    lineups: undefined,
    homeForm: [],
    awayForm: [],
    standings: undefined,
  };

  it("antes da escalação: not announced, sem ninguém fora", () => {
    const input = buildMatchJudgmentInput(base);
    expect(input.lineup).toEqual({
      home: { status: "not_announced" },
      away: { status: "not_announced" },
    });
    const state = buildJudgmentState(input.stateInput);
    expect(state.home_team.lineup).toBe("not announced");
    expect(state.home_team.starters_left_out).toEqual([]);
  });

  it("papel do desfalcado não vem da escalação deste jogo; vem do XI de referência", () => {
    // J10 no banco hoje: antes (v2) virava "rotation forward"; agora sem papel.
    const lineups = {
      fixtureId: "fx",
      home: {
        ...xi("Flamengo", [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 11]),
        bench: xi("Flamengo", [10]).starters,
      },
      away: xi(
        "Palmeiras",
        ELEVEN.map((n) => n + 100)
      ),
    };
    const noReference = buildJudgmentState(
      buildMatchJudgmentInput({ ...base, lineups }).stateInput
    );
    expect(noReference.home_team.absences).toEqual(["player (injured)"]);
    expect(noReference.home_team.lineup).toBe("announced, changes unknown");

    const withReference = buildMatchJudgmentInput({
      ...base,
      lineups,
      lineupBaseline: { home: xi("Flamengo", ELEVEN) },
    });
    const state = buildJudgmentState(withReference.stateInput);
    expect(state.home_team.absences).toEqual(["starting forward (injured)"]);
    // J10 está em absences → não é mudança voluntária.
    expect(state.home_team.lineup).toBe(
      "announced, 0 to 2 voluntary changes from the usual starting lineup"
    );
    expect(state.home_team.starters_left_out).toEqual([]);
    expect(state.away_team.lineup).toBe("announced, changes unknown");
    expect(withReference.lineup.home).toEqual({
      status: "announced",
      changes: "0-2",
      leftOut: [],
    });
  });

  it("providerAbsences mantém quem está no XI de hoje (conferência das afirmações)", () => {
    // J10 lesionado, mas titular hoje: sai de absences, fica em providerAbsences.
    const input = buildMatchJudgmentInput({
      ...base,
      lineups: {
        fixtureId: "fx",
        home: xi("Flamengo", ELEVEN),
        away: xi(
          "Palmeiras",
          ELEVEN.map((n) => n + 100)
        ),
      },
      lineupBaseline: { home: xi("Flamengo", ELEVEN) },
    });
    expect(input.absences.home).toEqual([]);
    expect(input.providerAbsences.home).toEqual([
      {
        injury: injuredJ10,
        position: "forward",
        isRegularStarter: true,
        isTopScorer: undefined,
      },
    ]);
  });

  it("o XI do jogo anterior vence o de referência no papel do desfalcado", () => {
    const input = buildMatchJudgmentInput({
      ...base,
      previousLineups: {
        home: {
          team: "Flamengo",
          starters: [],
          bench: [{ name: "J10", position: "FWD" }],
        },
      },
      lineupBaseline: { home: xi("Flamengo", ELEVEN) },
    });
    expect(buildJudgmentState(input.stateInput).home_team.absences).toEqual([
      "rotation forward (injured)",
    ]);
  });
});
