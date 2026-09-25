import { describe, expect, it } from "vitest";

import type {
  NormalizedInjury,
  NormalizedStanding,
  NormalizedStandingTeam,
} from "@/lib/providers/sports-data/types";

import {
  buildJudgmentState,
  contestMargin,
  describeAbsence,
  enrichAbsences,
  nextMatchBucket,
  restBucket,
  seasonStage,
  tableInputForLeague,
  tableSituation,
  type LeagueTableInput,
} from "../state";

function injury(
  name: string,
  status: NormalizedInjury["status"] = "injured"
): NormalizedInjury {
  return {
    player: { name },
    type: status === "suspended" ? "suspension" : "injury",
    reason: "Hamstring Injury",
    status,
  };
}

function row(
  position: number,
  points: number,
  played = 30,
  team = `Team ${position}`
): NormalizedStandingTeam {
  return {
    position,
    team,
    played,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points,
  };
}

function tableFromPoints(
  points: readonly number[],
  played: number
): LeagueTableInput {
  return {
    rows: points.map((p, i) => row(i + 1, p, played)),
    totalRounds: 38,
    continentalSpots: 6,
    relegationSpots: 4,
  };
}

// 20 times, 30 rodadas jogadas; pontos caem de 3 em 3 a partir de 70.
function table(played = 30): LeagueTableInput {
  return {
    rows: Array.from({ length: 20 }, (_, i) => row(i + 1, 70 - i * 3, played)),
    totalRounds: 38,
    continentalSpots: 6,
    relegationSpots: 4,
  };
}

describe("absences → papéis", () => {
  const lineup = {
    team: "Flamengo",
    starters: [
      { name: "Pedro Guilherme", position: "FWD" },
      { name: "Agustín Rossi", position: "GK" },
      { name: "Léo Pereira", position: "DEF" },
    ],
    bench: [
      { name: "Matheus Cunha", position: "GK" },
      { name: "Cleiton Silva", position: "DEF" },
    ],
  };

  it("deriva papel por posição + titularidade + artilharia", () => {
    const enriched = enrichAbsences(
      [
        injury("Pedro Guilherme"),
        injury("Agustin Rossi", "suspended"),
        injury("Matheus Cunha"),
        injury("Cleiton Silva", "doubtful"),
        injury("Léo Pereira"),
      ],
      { lastLineup: lineup, topScorerNames: ["pedro guilherme"] }
    );
    expect(enriched.map(describeAbsence)).toEqual([
      "starting forward, team top scorer (injured)",
      "first-choice goalkeeper (suspended)",
      "backup goalkeeper (injured)",
      "rotation defender (doubtful)",
      "starting defender (injured)",
    ]);
  });

  it("sem dados de papel → posição genérica ou 'player' + status", () => {
    expect(
      describeAbsence({ injury: injury("X"), position: "midfielder" })
    ).toBe("midfielder (injured)");
    expect(describeAbsence({ injury: injury("X", "doubtful") })).toBe(
      "player (doubtful)"
    );
  });
});

describe("calendário → buckets", () => {
  const kickoff = "2026-09-24T22:00:00Z";

  it("descanso", () => {
    expect(restBucket("2026-09-22T22:00:00Z", kickoff)).toBe(
      "short rest (<72h)"
    );
    expect(restBucket("2026-09-20T22:00:00Z", kickoff)).toBe("normal rest");
    expect(restBucket("2026-09-10T22:00:00Z", kickoff)).toBe(
      "long rest (>7 days)"
    );
    expect(restBucket(undefined, kickoff)).toBe("unknown");
    expect(restBucket("lixo", kickoff)).toBe("unknown");
  });

  it("próximo jogo, com competição", () => {
    expect(
      nextMatchBucket(kickoff, {
        kickoffAt: "2026-09-27T00:00:00Z",
        competition: "Copa Libertadores",
      })
    ).toBe("next match within 72h (Copa Libertadores)");
    expect(
      nextMatchBucket(kickoff, { kickoffAt: "2026-09-29T22:00:00Z" })
    ).toBe("next match in 3 to 7 days");
    expect(
      nextMatchBucket(kickoff, { kickoffAt: "2026-10-10T22:00:00Z" })
    ).toBe("next match more than 7 days away");
    expect(nextMatchBucket(kickoff, undefined)).toBe("unknown");
  });
});

describe("tabela → buckets", () => {
  it("zonas da tabela (tabela linear, rodada 30: alcance de 4 pts)", () => {
    const t = table();
    expect(tableSituation(t, "Team 1")).toBe("title race");
    expect(tableSituation(t, "Team 2")).toBe("title race"); // 3 pts atrás
    expect(tableSituation(t, "Team 3")).toBe("secure in continental places"); // 6 atrás, 12 à frente do 7º
    expect(tableSituation(t, "Team 6")).toBe("continental qualification race"); // 3 à frente do 7º
    expect(tableSituation(t, "Team 7")).toBe("continental qualification race"); // 3 atrás do G6
    expect(tableSituation(t, "Team 8")).toBe("safe mid-table"); // 6 atrás do G6
    expect(tableSituation(t, "Team 11")).toBe("safe mid-table");
    expect(tableSituation(t, "Team 15")).toBe("safe mid-table"); // 6 acima do Z4
    expect(tableSituation(t, "Team 16")).toBe("relegation battle"); // 3 acima do Z4
    expect(tableSituation(t, "Team 18")).toBe("relegation zone");
    expect(tableSituation(t, "Ninguém")).toBe("unknown");
    expect(tableSituation(undefined, "Team 1")).toBe("unknown");
  });

  it("12º na rodada 8, 6 pts do líder → não é briga pelo título", () => {
    const t = tableFromPoints(
      [
        18, 17, 16, 15, 14, 14, 13, 13, 12, 12, 12, 12, 11, 10, 10, 9, 8, 7, 6,
        5,
      ],
      8
    );
    expect(tableSituation(t, "Team 12")).toBe("safe mid-table");
    // O topo segue na briga.
    expect(tableSituation(t, "Team 2")).toBe("title race");
  });

  it("2º a 2 pts do líder na rodada 30 → briga pelo título", () => {
    const t = tableFromPoints(
      [
        62, 60, 55, 53, 50, 48, 47, 45, 44, 42, 40, 39, 38, 36, 35, 33, 30, 28,
        25, 20,
      ],
      30
    );
    expect(tableSituation(t, "Team 2")).toBe("title race");
    expect(tableSituation(t, "Team 17")).toBe("relegation zone");
  });

  it("15º a 2 pts do Z4 na reta final → briga contra o rebaixamento", () => {
    const t = tableFromPoints(
      [
        75, 70, 66, 62, 60, 58, 55, 52, 50, 48, 46, 44, 43, 41, 40, 39, 38, 35,
        30, 25,
      ],
      35
    );
    expect(tableSituation(t, "Team 15")).toBe("relegation battle");
    expect(tableSituation(t, "Team 17")).toBe("relegation zone");
  });

  it("alcance em pontos cresce com as rodadas restantes, limitado", () => {
    expect(contestMargin(30)).toBe(6);
    expect(contestMargin(8)).toBe(4);
    expect(contestMargin(3)).toBe(3);
    expect(contestMargin(1)).toBe(3);
    expect(contestMargin(0)).toBe(0);
  });

  it("começo de temporada → tabela não assentada", () => {
    expect(tableSituation(table(3), "Team 18")).toBe(
      "early season (table not settled)"
    );
  });

  it("estágio da temporada", () => {
    expect(seasonStage(table(3), ["Team 1", "Team 2"])).toBe("early season");
    expect(seasonStage(table(12), ["Team 1", "Team 2"])).toBe(
      "first half of season"
    );
    expect(seasonStage(table(25), ["Team 1", "Team 2"])).toBe(
      "second half of season"
    );
    expect(seasonStage(table(34), ["Team 1", "Team 2"])).toBe("final 5 rounds");
    expect(seasonStage(undefined, ["Team 1"])).toBe("unknown");
  });

  it("config de zonas só pra liga de pontos corridos com tabela única", () => {
    const standing: NormalizedStanding = {
      league: "brasileirao_a",
      season: 2026,
      tables: [{ teams: table().rows as NormalizedStandingTeam[] }],
    };
    expect(
      tableInputForLeague("brasileirao_a", standing)?.relegationSpots
    ).toBe(4);
    expect(
      tableInputForLeague("champions_league", {
        ...standing,
        league: "champions_league",
      })
    ).toBeUndefined();
    expect(tableInputForLeague("brasileirao_a", undefined)).toBeUndefined();
  });
});

describe("buildJudgmentState", () => {
  const PLAYER_NAMES = [
    "Pedro Guilherme",
    "Agustín Rossi",
    "Giorgian De Arrascaeta",
    "Hulk",
  ];

  const state = buildJudgmentState({
    competition: "Brazilian Serie A",
    kickoffAt: "2026-09-24T22:00:00Z",
    home: {
      name: "Team 1",
      absences: enrichAbsences(
        [injury("Pedro Guilherme"), injury("Agustín Rossi", "suspended")],
        {
          lastLineup: {
            team: "Team 1",
            starters: [
              { name: "Pedro Guilherme", position: "FWD" },
              { name: "Agustín Rossi", position: "GK" },
            ],
          },
          topScorerNames: ["Pedro Guilherme"],
        }
      ),
      previousKickoffAt: "2026-09-22T22:00:00Z",
      nextFixture: {
        kickoffAt: "2026-09-26T22:00:00Z",
        competition: "Copa Libertadores",
      },
    },
    away: {
      name: "Team 18",
      absences: enrichAbsences([
        injury("Giorgian De Arrascaeta", "doubtful"),
        injury("Hulk"),
      ]),
    },
    table: table(34),
  });

  it("nunca contém nome de jogador", () => {
    const json = JSON.stringify(state);
    for (const name of PLAYER_NAMES) {
      expect(json).not.toContain(name);
      expect(json.toLowerCase()).not.toContain(
        name.split(" ")[0].toLowerCase()
      );
    }
    // O `reason` do provider (dado de saúde) também não vai.
    expect(json).not.toContain("Hamstring");
  });

  it("monta os buckets de cada time", () => {
    expect(state).toEqual({
      match: {
        competition: "Brazilian Serie A",
        season_stage: "final 5 rounds",
      },
      home_team: {
        name: "Team 1",
        absences: [
          "starting forward, team top scorer (injured)",
          "first-choice goalkeeper (suspended)",
        ],
        rest_before_match: "short rest (<72h)",
        next_match: "next match within 72h (Copa Libertadores)",
        league_situation: "title race",
      },
      away_team: {
        name: "Team 18",
        absences: ["player (doubtful)", "player (injured)"],
        rest_before_match: "unknown",
        next_match: "unknown",
        league_situation: "relegation zone",
      },
    });
  });
});
