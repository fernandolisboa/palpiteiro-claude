import { describe, expect, it } from "vitest";

import { enrichAbsences, type JudgmentAbsenceInput } from "@/lib/ai/judgments/state";
import type {
  NormalizedFixture,
  NormalizedInjury,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import {
  checkClaims,
  factsNeeded,
  matchPlayer,
  normalizePlayerName,
  stripPlayerNames,
  type PalpiteFacts,
} from "@/lib/user-palpite/check-claims";
import type { Claim } from "@/lib/user-palpite/types";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const KICKOFF = new Date("2026-05-20T19:00:00Z");

function inj(name: string, status: NormalizedInjury["status"]): NormalizedInjury {
  return {
    player: { name },
    type: status === "suspended" ? "suspension" : "injury",
    status,
  };
}

function absences(
  home: JudgmentAbsenceInput[],
  away: JudgmentAbsenceInput[] = [],
): PalpiteFacts["absences"] {
  return { available: true, data: { home, away } };
}

function fixture(
  team: string,
  daysBefore: number,
  gf: number,
  ga: number,
): NormalizedFixture {
  const kickoff = new Date(KICKOFF.getTime() - daysBefore * 86_400_000);
  return {
    id: `f-${team}-${daysBefore}`,
    league: "brasileirao_a",
    kickoffAt: kickoff.toISOString(),
    kickoffTimestampMs: kickoff.getTime(),
    homeTeam: team,
    awayTeam: "Outro",
    status: "finished",
    score: { home: gf, away: ga },
  };
}

// W/D/L do time em 5 jogos (o mais recente primeiro), o 1º há `firstGapDays` dias.
function form(team: string, results: string, firstGapDays = 7): NormalizedFixture[] {
  return [...results].map((r, i) =>
    fixture(team, firstGapDays + i * 7, r === "W" ? 2 : r === "D" ? 1 : 0, r === "L" ? 1 : r === "D" ? 1 : 0),
  );
}

function standing(): NormalizedStanding {
  const names = Array.from({ length: 20 }, (_, i) => `Time ${i + 1}`);
  names[1] = "Flamengo";
  names[9] = "Palmeiras";
  return {
    league: "brasileirao_a",
    season: 2026,
    tables: [
      {
        teams: names.map((team, i) => ({
          position: i + 1,
          team,
          played: 30,
          won: 10,
          draw: 5,
          lost: 15,
          goalsFor: 30,
          goalsAgainst: 30,
          points: 65 - 2 * (i + 1),
        })),
      },
    ],
  };
}

function check(claims: Claim[], facts: PalpiteFacts, league: "brasileirao_a" | "premier_league" = "brasileirao_a") {
  return checkClaims({ claims, facts, teams: TEAMS, league, kickoffAt: KICKOFF });
}

const absence = (players: string[], role: Claim["role"] = "attack"): Claim => ({
  team: "home",
  topic: "absence",
  text: "o jogador citado está fora",
  players,
  role,
});

describe("nomes", () => {
  it("normaliza acento e caixa", () => {
    expect(normalizePlayerName("G. de Arrascaeta")).toBe("g de arrascaeta");
  });

  it("casa 'Arrascaeta' com 'G. De Arrascaeta'; ambíguo; nenhum", () => {
    const list = enrichAbsences([inj("G. De Arrascaeta", "injured"), inj("Pedro", "injured")]);
    expect(matchPlayer("Arrascaeta", list).kind).toBe("match");
    expect(matchPlayer("pedro", list).kind).toBe("match");
    const dup = enrichAbsences([inj("Bruno Henrique", "injured"), inj("Bruno Fuchs", "injured")]);
    expect(matchPlayer("Bruno", dup).kind).toBe("ambiguous");
    expect(matchPlayer("Henrique Fuchs", dup).kind).toBe("ambiguous");
    expect(matchPlayer("Gabigol", list).kind).toBe("none");
  });

  it("stripPlayerNames tira os nomes citados da paráfrase", () => {
    expect(stripPlayerNames("Arrascaeta está fora por lesão", ["Arrascaeta"])).toBe(
      "o jogador citado está fora por lesão",
    );
    expect(
      stripPlayerNames("sem Pedro e G. de Arrascaeta, o ataque perde força", [
        "Pedro",
        "G. de Arrascaeta",
      ]),
    ).toBe("sem o jogador citado e o jogador citado, o ataque perde força");
    expect(stripPlayerNames("Pedro de volta ao time", ["Pedro"])).toBe(
      "o jogador citado de volta ao time",
    );
    expect(stripPlayerNames("sem Arrascaeta.", ["Arrascaeta"])).toBe(
      "sem o jogador citado.",
    );
    expect(stripPlayerNames("time completo", [])).toBe("time completo");
  });
});

describe("absence", () => {
  it("casou e está fora → confirmada; papel da afirmação → sinal de não verificável", () => {
    const [c] = check([absence(["Arrascaeta"])], {
      absences: absences(enrichAbsences([inj("G. De Arrascaeta", "injured")])),
    });
    expect(c.status).toBe("confirmed");
    expect(c.evidence).toContain("Está na nossa lista de desfalques do Flamengo");
    expect(c.signals).toEqual([
      { questionId: "attack_weakened_home", strength: "unverified" },
    ]);
    expect(c.playerChecks).toEqual([
      { name: "Arrascaeta", status: "confirmed", questionId: "attack_weakened_home" },
    ]);
  });

  it("posição nossa (atacante titular) → sinal confirmado; meio-campista usa o papel da afirmação", () => {
    const forward: JudgmentAbsenceInput = {
      injury: inj("Pedro", "injured"),
      position: "forward",
      isRegularStarter: true,
    };
    const [c] = check([absence(["Pedro"], "defense")], { absences: absences([forward]) });
    expect(c.signals).toEqual([{ questionId: "attack_weakened_home", strength: "confirmed" }]);
    const mid: JudgmentAbsenceInput = {
      injury: inj("Pedro", "injured"),
      position: "midfielder",
      isRegularStarter: true,
    };
    const [m] = check([absence(["Pedro"], "defense")], { absences: absences([mid]) });
    expect(m.signals).toEqual([{ questionId: "defense_weakened_home", strength: "unverified" }]);
  });

  it("reserva no último jogo → sem fator", () => {
    const bench: JudgmentAbsenceInput = {
      injury: inj("Pedro", "injured"),
      position: "forward",
      isRegularStarter: false,
    };
    const [c] = check([absence(["Pedro"])], { absences: absences([bench]) });
    expect(c.signals).toEqual([]);
    expect(c.evidence).toContain("reserva no último jogo");
  });

  it("dúvida, não está na lista ou lista indisponível → não verificável, nunca contradita", () => {
    const [d] = check([absence(["Pedro"])], {
      absences: absences(enrichAbsences([inj("Pedro", "doubtful")])),
    });
    expect(d.status).toBe("unverifiable");
    expect(d.evidence).toContain("dúvida");
    const [n] = check([absence(["Pedro"])], { absences: absences([]) });
    expect(n.status).toBe("unverifiable");
    expect(n.evidence).toContain("pode ser informação mais nova");
    const [u] = check([absence(["Pedro"])], { absences: { available: false } });
    expect(u.status).toBe("unverifiable");
    expect(u.evidence).toBe("Não temos a lista de desfalques deste jogo.");
    expect(u.signals).toEqual([{ questionId: "attack_weakened_home", strength: "unverified" }]);
    const [nf] = check([absence(["Pedro"])], {});
    expect(nf.status).toBe("unverifiable");
  });

  it("vários jogadores: resultado por jogador; papel unknown não gera sinal", () => {
    const [c] = check([absence(["Pedro", "Gerson"], "unknown")], {
      absences: absences(enrichAbsences([inj("Pedro", "injured")])),
    });
    expect(c.status).toBe("unverifiable");
    expect(c.playerChecks.map((p) => p.status)).toEqual(["confirmed", "unverifiable"]);
    expect(c.evidence).toContain("1º citado:");
    expect(c.signals).toEqual([]);
  });

  it("a evidência nunca traz nome vindo do provider nem o citado", () => {
    const list = enrichAbsences([
      inj("Giorgian De Arrascaeta", "injured"),
      inj("Pedro Guilherme", "suspended"),
    ]);
    const out = check(
      [
        absence(["Arrascaeta"]),
        { team: "home", topic: "full_squad", text: "time completo", scope: "all" },
      ],
      { absences: absences(list) },
    );
    for (const c of out) {
      expect(c.evidence).not.toMatch(/Arrascaeta|Giorgian|Pedro|Guilherme/);
    }
  });
});

describe("full_squad", () => {
  const squad = (scope: Claim["scope"]): Claim => ({
    team: "home",
    topic: "full_squad",
    text: "time completo",
    scope,
  });

  it("só dúvidas → confirmada; lesionado → contradita; nunca gera sinal", () => {
    const [ok] = check([squad("all")], {
      absences: absences(enrichAbsences([inj("Pedro", "doubtful")])),
    });
    expect(ok.status).toBe("confirmed");
    const [bad] = check([squad("injuries")], {
      absences: absences(enrichAbsences([inj("Pedro", "injured")])),
    });
    expect(bad.status).toBe("contradicted");
    expect(bad.evidence).toContain("A nossa lista tem 1 fora no Flamengo");
    expect(bad.signals).toEqual([]);
    const [susp] = check([squad("injuries")], {
      absences: absences(enrichAbsences([inj("Pedro", "suspended")])),
    });
    expect(susp.status).toBe("confirmed");
  });

  it("lista vazia (jogo não casou / sem cobertura) → não verificável, nunca confirma", () => {
    const [c] = check([squad("all")], { absences: absences([], []) });
    expect(c.status).toBe("unverifiable");
    expect(c.evidence).toContain("pode estar incompleta");
  });

  it("lista indisponível → não verificável", () => {
    const [c] = check([squad("all")], { absences: { available: false } });
    expect(c.status).toBe("unverifiable");
  });

  it("both com um lado contradito → contradita", () => {
    const [c] = check(
      [{ team: "both", topic: "full_squad", text: "os dois completos", scope: "all" }],
      { absences: absences(enrichAbsences([inj("A", "doubtful")]), enrichAbsences([inj("B", "injured")])) },
    );
    expect(c.status).toBe("contradicted");
    expect(c.sides).toEqual([
      { side: "home", status: "confirmed" },
      { side: "away", status: "contradicted" },
    ]);
  });
});

describe("form", () => {
  const good: Claim = { team: "home", topic: "form", text: "vem de vitórias", direction: "good" };
  const facts = (home: NormalizedFixture[]): PalpiteFacts => ({
    form: { available: true, data: { home, away: [] } },
  });

  it("fronteiras: V=3 confirma, V=2 no meio, V=1 contradiz", () => {
    expect(check([good], facts(form("Flamengo", "WWWLL")))[0].status).toBe("confirmed");
    expect(check([good], facts(form("Flamengo", "WWDLL")))[0].status).toBe("unverifiable");
    const [c] = check([good], facts(form("Flamengo", "WDDLL")));
    expect(c.status).toBe("contradicted");
    expect(c.evidence).toBe("Últimos 5 jogos do Flamengo: 1V 2E 2D.");
    expect(c.signals).toEqual([]);
  });

  it("menos de 3 jogos ou forma indisponível → não verificável", () => {
    expect(check([good], facts(form("Flamengo", "WW")))[0].status).toBe("unverifiable");
    expect(check([good], { form: { available: false } })[0].status).toBe("unverifiable");
  });

  it("bad conta derrotas", () => {
    const bad: Claim = { ...good, direction: "bad" };
    expect(check([bad], facts(form("Flamengo", "LLLWW")))[0].status).toBe("confirmed");
  });
});

describe("rotation", () => {
  const rot: Claim = { team: "home", topic: "rotation", text: "vai poupar titulares" };
  it("jogou há 60h → confirmada com sinal confirmado", () => {
    const home = [fixture("Flamengo", 2.5, 1, 0)];
    const [c] = check([rot], { form: { available: true, data: { home, away: [] } } });
    expect(c.status).toBe("confirmed");
    expect(c.signals).toEqual([{ questionId: "rotation_risk_home", strength: "confirmed" }]);
  });

  it("jogou há 100h → não verificável com sinal de não verificável", () => {
    const home = [fixture("Flamengo", 100 / 24, 1, 0)];
    const [c] = check([rot], { form: { available: true, data: { home, away: [] } } });
    expect(c.status).toBe("unverifiable");
    expect(c.signals).toEqual([{ questionId: "rotation_risk_home", strength: "unverified" }]);
  });
});

describe("stakes", () => {
  const stakes = (team: Claim["team"], direction: "good" | "bad"): Claim => ({
    team,
    topic: "stakes",
    text: "jogo decisivo",
    direction,
  });
  const facts: PalpiteFacts = { standings: { available: true, data: standing() } };

  it("brasileirão: briga pelo título confirma 'good' com sinal", () => {
    const [c] = check([stakes("home", "good")], facts);
    expect(c.status).toBe("confirmed");
    expect(c.evidence).toBe("Na tabela: 2º com 61 pontos (briga pelo título).");
    expect(c.signals).toEqual([{ questionId: "high_stakes_home", strength: "confirmed" }]);
  });

  it("meio da tabela contradiz 'good' e confirma 'bad' (sem sinal)", () => {
    const [c] = check([stakes("away", "good")], facts);
    expect(c.status).toBe("contradicted");
    expect(c.signals).toEqual([]);
    const [b] = check([stakes("away", "bad")], facts);
    expect(b.status).toBe("confirmed");
    expect(b.signals).toEqual([]);
  });

  it("both com um lado contradito: o outro lado ainda manda sinal", () => {
    const [c] = check([stakes("both", "good")], facts);
    expect(c.status).toBe("contradicted");
    expect(c.signals).toEqual([{ questionId: "high_stakes_home", strength: "confirmed" }]);
  });

  it("premier_league (sem config de tabela) → não verificável com sinal de não verificável", () => {
    const [c] = check([stakes("home", "good")], facts, "premier_league");
    expect(c.status).toBe("unverifiable");
    expect(c.signals).toEqual([{ questionId: "high_stakes_home", strength: "unverified" }]);
  });
});

describe("other e factsNeeded", () => {
  it("other é sempre não verificável, sem sinal", () => {
    const [c] = check([{ team: "both", topic: "other", text: "é clássico" }], {});
    expect(c.status).toBe("unverifiable");
    expect(c.signals).toEqual([]);
  });

  it("factsNeeded só pede o que as afirmações citam", () => {
    expect(factsNeeded([])).toEqual({ absences: false, form: false, standings: false });
    expect(factsNeeded([{ team: "home", topic: "rotation", text: "x" }])).toEqual({
      absences: false,
      form: true,
      standings: false,
    });
    expect(
      factsNeeded([
        { team: "home", topic: "full_squad", text: "x", scope: "all" },
        { team: "home", topic: "stakes", text: "x", direction: "good" },
      ]),
    ).toEqual({ absences: true, form: false, standings: true });
  });
});
