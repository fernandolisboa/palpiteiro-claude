import { describe, expect, it } from "vitest";

import type {
  NormalizedInjury,
  NormalizedLineupPlayer,
  NormalizedStanding,
  NormalizedStandingTeam,
  NormalizedTeamLineup,
} from "@/lib/providers/sports-data/types";

import {
  buildJudgmentState,
  competitionStage,
  contestMargin,
  describeAbsence,
  enrichAbsences,
  lineupChangeBucket,
  lineupStateFields,
  nextMatchBucket,
  restBucket,
  seasonStage,
  summarizeLineup,
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

  it("próximo jogo com fase do torneio (#617)", () => {
    expect(
      nextMatchBucket(kickoff, {
        kickoffAt: "2026-09-27T00:00:00Z",
        competition: "CONMEBOL Libertadores",
        round: "Quarter-finals",
      })
    ).toBe("next match within 72h (CONMEBOL Libertadores, knockout)");
    expect(
      nextMatchBucket(kickoff, {
        kickoffAt: "2026-09-29T22:00:00Z",
        competition: "UEFA Champions League",
        round: "League Stage - 5",
      })
    ).toBe("next match in 3 to 7 days (UEFA Champions League, group stage)");
    expect(
      nextMatchBucket(kickoff, {
        kickoffAt: "2026-09-27T00:00:00Z",
        competition: "Serie A",
        round: "Regular Season - 30",
      })
    ).toBe("next match within 72h (Serie A)");
  });

  it("fase do torneio a partir do round cru da API-Football", () => {
    for (const round of [
      "Round of 16",
      "Quarter-finals",
      "Semi-finals",
      "Final",
      "Knockout Round Play-offs",
      "3rd Round",
      "1st Round",
      "2nd Qualifying Round",
      "Preliminary Round",
    ]) {
      expect(competitionStage(round), round).toBe("knockout");
    }
    for (const round of ["Group A - 3", "League Stage - 5", "Group Stage - 1"]) {
      expect(competitionStage(round), round).toBe("group stage");
    }
    expect(competitionStage("Regular Season - 12")).toBeUndefined();
    expect(competitionStage("Relegation Group - 3")).toBeUndefined();
    expect(competitionStage(undefined)).toBeUndefined();
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

  it("Premier League e La Liga têm zonas (#617): 4 vagas de Champions, 3 rebaixados", () => {
    for (const league of ["premier_league", "la_liga"] as const) {
      const input = tableInputForLeague(league, {
        league,
        season: 2026,
        tables: [{ teams: table().rows as NormalizedStandingTeam[] }],
      });
      expect(input?.continentalSpots).toBe(4);
      expect(input?.relegationSpots).toBe(3);
      expect(input?.totalRounds).toBe(38);
    }
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
      lineup: { status: "not_announced" },
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
      lineup: {
        status: "announced",
        changes: "3-4",
        leftOut: [
          { position: "goalkeeper", whereabouts: "bench" },
          { position: "forward", whereabouts: "out_of_squad" },
          { position: "midfielder", whereabouts: "bench" },
        ],
      },
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
        lineup: "not announced",
        starters_left_out: [],
        rest_before_match: "short rest (<72h)",
        next_match: "next match within 72h (Copa Libertadores)",
        league_situation: "title race",
      },
      away_team: {
        name: "Team 18",
        absences: ["player (doubtful)", "player (injured)"],
        lineup:
          "announced, 3 to 4 voluntary changes from the usual starting lineup",
        // Na ordem que o summarizeLineup entregou (ele ordena; aqui é só o texto).
        starters_left_out: [
          "first-choice goalkeeper (on the bench)",
          "starting forward (not in the squad)",
          "starting midfielder (on the bench)",
        ],
        rest_before_match: "unknown",
        next_match: "unknown",
        league_situation: "relegation zone",
      },
    });
  });
});

// ─── Escalação confirmada (#619) ────────────────────────────────────────────

// Nomes marcantes: nenhum pode aparecer no state (LGPD).
const SURNAMES = [
  "Xablau",
  "Quixotinho",
  "Zeferindo",
  "Bortolozzo",
  "Pafúncio",
  "Gumercindo",
  "Teodorico",
  "Wellingtão",
  "Craudiomiro",
  "Esmeraldino",
  "Florisvaldo",
  "Anacleto",
  "Belarmino",
  "Cremildo",
  "Deoclécio",
  "Eustáquio",
];
// 4-3-3: GK, 4 DEF, 3 MID, 3 FWD.
const XI_POSITIONS = [
  "GK",
  "DEF",
  "DEF",
  "DEF",
  "DEF",
  "MID",
  "MID",
  "MID",
  "FWD",
  "FWD",
  "FWD",
];

function player(
  id: number,
  position?: string,
  prefix = "api-football"
): NormalizedLineupPlayer {
  return {
    name: `Jogador ${SURNAMES[id - 1] ?? id}`,
    ...(position ? { position } : {}),
    providerPlayerId: `${prefix}:${id}`,
  };
}

// XI de referência: ids 1..11 nas posições do 4-3-3.
function referenceXi(prefix = "api-football"): NormalizedTeamLineup {
  return {
    team: "Team 1",
    starters: XI_POSITIONS.map((pos, i) => player(i + 1, pos, prefix)),
  };
}

// Hoje: troca os ids de `out` por reservas (12, 13…) e põe `benched` no banco.
function todayXi(
  out: readonly number[],
  opts: { benched?: readonly number[]; bench?: boolean } = {}
): NormalizedTeamLineup {
  let sub = 12;
  const starters = XI_POSITIONS.map((pos, i) =>
    out.includes(i + 1) ? player(sub++, pos) : player(i + 1, pos)
  );
  return {
    team: "Team 1",
    starters,
    ...(opts.bench === false
      ? {}
      : { bench: [...(opts.benched ?? []), 16].map((id) => player(id)) }),
  };
}

const absentee = (id: number, status: NormalizedInjury["status"] = "injured") =>
  injury(`Jogador ${SURNAMES[id - 1]}`, status);

describe("lineupChangeBucket (#619)", () => {
  it("bordas: 2 → 0-2, 3 e 4 → 3-4, 5 → 5+", () => {
    expect(lineupChangeBucket(0)).toBe("0-2");
    expect(lineupChangeBucket(2)).toBe("0-2");
    expect(lineupChangeBucket(3)).toBe("3-4");
    expect(lineupChangeBucket(4)).toBe("3-4");
    expect(lineupChangeBucket(5)).toBe("5+");
    expect(lineupChangeBucket(11)).toBe("5+");
  });
});

describe("summarizeLineup (#619)", () => {
  it("sem escalação de hoje → not_announced; sem referência → mudanças desconhecidas", () => {
    expect(summarizeLineup({ reference: referenceXi(), absences: [] })).toEqual(
      { status: "not_announced" }
    );
    expect(summarizeLineup({ today: todayXi([]), absences: [] })).toEqual({
      status: "announced",
      changes: null,
      leftOut: [],
    });
  });

  it("mesmo XI → 0-2 sem ninguém fora", () => {
    expect(
      summarizeLineup({
        today: todayXi([]),
        reference: referenceXi(),
        absences: [],
      })
    ).toEqual({ status: "announced", changes: "0-2", leftOut: [] });
  });

  it("titulares fora por escolha: banco × fora da lista, ordenados GK, DEF, MID, FWD", () => {
    const summary = summarizeLineup({
      // Atacante (9), meia (6), goleiro (1) e zagueiro (2) fora; 1 e 9 no banco.
      today: todayXi([9, 6, 1, 2], { benched: [9, 1] }),
      reference: referenceXi(),
      absences: [],
    });
    expect(summary).toEqual({
      status: "announced",
      changes: "3-4",
      leftOut: [
        { position: "goalkeeper", whereabouts: "bench" },
        { position: "defender", whereabouts: "out_of_squad" },
        { position: "midfielder", whereabouts: "out_of_squad" },
        { position: "forward", whereabouts: "bench" },
      ],
    });
    expect(lineupStateFields(summary)).toEqual({
      lineup:
        "announced, 3 to 4 voluntary changes from the usual starting lineup",
      starters_left_out: [
        "first-choice goalkeeper (on the bench)",
        "starting defender (not in the squad)",
        "starting midfielder (not in the squad)",
        "starting forward (on the bench)",
      ],
    });
  });

  it("voluntária × forçada: titular habitual em `absences` não conta", () => {
    // 6 titulares fora; 4 deles desfalcados (lesão/suspensão) → 2 voluntárias.
    const summary = summarizeLineup({
      today: todayXi([2, 3, 6, 7, 9, 10]),
      reference: referenceXi(),
      absences: enrichAbsences([
        absentee(2),
        absentee(3, "suspended"),
        absentee(6),
        absentee(9),
      ]),
    });
    expect(summary).toEqual({
      status: "announced",
      changes: "0-2",
      leftOut: [
        { position: "midfielder", whereabouts: "out_of_squad" },
        { position: "forward", whereabouts: "out_of_squad" },
      ],
    });
    // Sem desfalques, as mesmas 6 trocas são 5+.
    expect(
      summarizeLineup({
        today: todayXi([2, 3, 6, 7, 9, 10]),
        reference: referenceXi(),
        absences: [],
      })
    ).toMatchObject({ changes: "5+" });
  });

  it("sem banco na resposta → sem parênteses; posição desconhecida → starting player", () => {
    const reference = referenceXi();
    reference.starters[10] = { ...reference.starters[10], position: undefined };
    const summary = summarizeLineup({
      today: todayXi([11, 1], { bench: false }),
      reference,
      absences: [],
    });
    expect(lineupStateFields(summary).starters_left_out).toEqual([
      "first-choice goalkeeper",
      "starting player",
    ]);
    // Banco presente com posição desconhecida.
    expect(
      lineupStateFields(
        summarizeLineup({
          today: todayXi([11], { benched: [11] }),
          reference,
          absences: [],
        })
      ).starters_left_out
    ).toEqual(["starting player (on the bench)"]);
  });

  it("banco sem id do provider → sem parênteses (não dá pra dizer onde está)", () => {
    const today = todayXi([9], { benched: [9] });
    today.bench = today.bench!.map(({ providerPlayerId: _id, ...p }) => p);
    expect(
      lineupStateFields(
        summarizeLineup({ today, reference: referenceXi(), absences: [] })
      ).starters_left_out
    ).toEqual(["starting forward"]);
  });

  it("providers misturados, jogador sem id na referência ou XI incompleto → mudanças desconhecidas", () => {
    const unknown = { status: "announced", changes: null, leftOut: [] };
    // Referência do football-data.org × hoje da API-Football.
    expect(
      summarizeLineup({
        today: todayXi([]),
        reference: referenceXi("football-data-org"),
        absences: [],
      })
    ).toEqual(unknown);
    // Um titular da referência sem id.
    const refNoId = referenceXi();
    refNoId.starters[4] = { name: "Jogador Sem Id", position: "DEF" };
    expect(
      summarizeLineup({ today: todayXi([]), reference: refNoId, absences: [] })
    ).toEqual(unknown);
    // Hoje sem id nenhum (fallback football-data.org) × referência da API-Football.
    const noIds = todayXi([]);
    noIds.starters = noIds.starters.map(({ providerPlayerId: _id, ...p }) => p);
    expect(
      summarizeLineup({ today: noIds, reference: referenceXi(), absences: [] })
    ).toEqual(unknown);
    // Ids repetidos no XI de hoje ou no de referência.
    const dupToday = todayXi([]);
    dupToday.starters[4] = player(4, "DEF");
    expect(
      summarizeLineup({ today: dupToday, reference: referenceXi(), absences: [] })
    ).toEqual(unknown);
    const dupRef = referenceXi();
    dupRef.starters[4] = player(4, "DEF");
    expect(
      summarizeLineup({ today: todayXi([]), reference: dupRef, absences: [] })
    ).toEqual(unknown);
    // Prefixos misturados dentro do mesmo XI.
    const mixed = todayXi([]);
    mixed.starters[4] = player(5, "DEF", "football-data-org");
    expect(
      summarizeLineup({ today: mixed, reference: referenceXi(), absences: [] })
    ).toEqual(unknown);
    // XI de 10.
    const ten = todayXi([]);
    ten.starters.pop();
    expect(
      summarizeLineup({ today: ten, reference: referenceXi(), absences: [] })
    ).toEqual(unknown);
    expect(lineupStateFields(unknown as never)).toEqual({
      lineup: "announced, changes unknown",
      starters_left_out: [],
    });
  });

  it("titular de hoje sem id (estreante) não impede a contagem", () => {
    // O id 5 sai e entra um estreante sem id: conta 1 mudança, como deve.
    const today = todayXi([]);
    today.starters[4] = { name: "Jogador Estreante", position: "DEF" };
    expect(
      summarizeLineup({ today, reference: referenceXi(), absences: [] })
    ).toEqual({
      status: "announced",
      changes: "0-2",
      leftOut: [{ position: "defender", whereabouts: "out_of_squad" }],
    });
  });

  it("XI de hoje vazio = escalação não anunciada", () => {
    expect(
      summarizeLineup({
        today: { team: "Team 1", starters: [], bench: [] },
        reference: referenceXi(),
        absences: [],
      })
    ).toEqual({ status: "not_announced" });
  });

  it("desfalcado casa com o XI de referência por id mesmo com o nome curto", () => {
    // /injuries grafa "J. Pafúncio"; a referência tem "Jogador Pafúncio", id 5.
    const shortName: NormalizedInjury = {
      ...injury("J. Pafúncio"),
      player: { name: "J. Pafúncio", providerPlayerId: "api-football:5" },
    };
    const absences = enrichAbsences([shortName], {
      lastLineup: referenceXi(),
    });
    expect(absences.map(describeAbsence)).toEqual([
      "starting defender (injured)",
    ]);
    // Forçada, não voluntária: o 5 fora hoje não entra em starters_left_out.
    expect(
      summarizeLineup({
        today: todayXi([5]),
        reference: referenceXi(),
        absences,
      })
    ).toEqual({ status: "announced", changes: "0-2", leftOut: [] });
  });

  it("vocabulário do campo lineup", () => {
    expect(lineupStateFields({ status: "not_announced" })).toEqual({
      lineup: "not announced",
      starters_left_out: [],
    });
    for (const [bucket, text] of [
      [
        "0-2",
        "announced, 0 to 2 voluntary changes from the usual starting lineup",
      ],
      [
        "3-4",
        "announced, 3 to 4 voluntary changes from the usual starting lineup",
      ],
      [
        "5+",
        "announced, 5 or more voluntary changes from the usual starting lineup",
      ],
    ] as const) {
      expect(
        lineupStateFields({ status: "announced", changes: bucket, leftOut: [] })
          .lineup
      ).toBe(text);
    }
  });
});

describe("enrichAbsences com a escalação confirmada (#619)", () => {
  it("em dúvida entre os titulares de hoje sai de absences; em dúvida no banco fica", () => {
    const today = todayXi([9], { benched: [9] });
    const absences = enrichAbsences(
      [absentee(9, "doubtful"), absentee(10, "doubtful")],
      { lastLineup: referenceXi(), confirmedLineup: today }
    );
    // 10 está no XI de hoje (vai jogar); 9 está no banco (segue desfalque).
    expect(absences.map(describeAbsence)).toEqual([
      "starting forward (doubtful)",
    ]);
    // E quem segue em absences não entra em starters_left_out.
    expect(
      lineupStateFields(
        summarizeLineup({ today, reference: referenceXi(), absences })
      )
    ).toEqual({
      lineup:
        "announced, 0 to 2 voluntary changes from the usual starting lineup",
      starters_left_out: [],
    });
  });

  it("lesionado (não só em dúvida) entre os titulares de hoje também sai", () => {
    const absences = enrichAbsences([absentee(10), absentee(3, "suspended")], {
      lastLineup: referenceXi(),
      confirmedLineup: todayXi([]),
    });
    expect(absences).toEqual([]);
  });

  it("por id: nome curto do /injuries × nome completo do XI de hoje", () => {
    const short: NormalizedInjury = {
      ...injury("J. Wellingtão", "doubtful"),
      player: { name: "J. Wellingtão", providerPlayerId: "api-football:8" },
    };
    expect(
      enrichAbsences([short], {
        lastLineup: referenceXi(),
        confirmedLineup: todayXi([]),
      })
    ).toEqual([]);
    // Mesmo id em outro jogador do XI não importa: o 8 no banco segue desfalque.
    expect(
      enrichAbsences([short], {
        lastLineup: referenceXi(),
        confirmedLineup: todayXi([8], { benched: [8] }),
      }).map(describeAbsence)
    ).toEqual(["starting midfielder (doubtful)"]);
  });

  it("id de outro provider → cai no nome normalizado", () => {
    // Desfalque do SportMonks (outro prefixo) com o nome igual ao do XI.
    const other: NormalizedInjury = {
      ...injury("Jogador Wellingtão", "doubtful"),
      player: { name: "Jogador Wellingtão", providerPlayerId: "sportmonks:99" },
    };
    expect(
      enrichAbsences([other], {
        lastLineup: referenceXi(),
        confirmedLineup: todayXi([]),
      })
    ).toEqual([]);
    // Nome curto + outro provider: não casa (sem id comum, nome diferente).
    const otherShort: NormalizedInjury = {
      ...other,
      player: { name: "J. Wellingtão", providerPlayerId: "sportmonks:99" },
    };
    expect(
      enrichAbsences([otherShort], {
        lastLineup: referenceXi(),
        confirmedLineup: todayXi([]),
      }).map(describeAbsence)
    ).toEqual(["player (doubtful)"]);
  });

  it("XI de hoje vazio não tira ninguém de absences", () => {
    expect(
      enrichAbsences([absentee(10, "doubtful")], {
        lastLineup: referenceXi(),
        confirmedLineup: { team: "Team 1", starters: [] },
      }).map(describeAbsence)
    ).toEqual(["starting forward (doubtful)"]);
  });

  it("sem a escalação confirmada nada muda", () => {
    expect(
      enrichAbsences([absentee(10, "doubtful")], {
        lastLineup: referenceXi(),
      }).map(describeAbsence)
    ).toEqual(["starting forward (doubtful)"]);
  });
});

describe("LGPD com a escalação (#619)", () => {
  it("nenhum nome de jogador do XI de hoje, da referência ou dos desfalques vai pro state", () => {
    const today = todayXi([2, 6, 9], { benched: [9] });
    const absences = enrichAbsences([absentee(2), absentee(4, "doubtful")], {
      lastLineup: referenceXi(),
      confirmedLineup: today,
    });
    const team = {
      name: "Team 1",
      absences,
      lineup: summarizeLineup({ today, reference: referenceXi(), absences }),
    };
    const state = buildJudgmentState({
      competition: "Brazilian Serie A",
      kickoffAt: "2026-09-24T22:00:00Z",
      home: team,
      away: { ...team, name: "Team 2" },
    });
    expect(state.home_team.starters_left_out).toEqual([
      "starting midfielder (not in the squad)",
      "starting forward (on the bench)",
    ]);
    const json = JSON.stringify(state);
    for (const surname of SURNAMES) {
      expect(json).not.toContain(surname);
    }
    expect(json).not.toContain("Jogador");
    expect(json).not.toContain("api-football:");
  });
});
