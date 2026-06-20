import { describe, expect, it } from "vitest";

import { checkFidelity } from "@/lib/ai/palpites/fidelity-validator";
import type {
  PalpiteSynthesisOutput,
  PalpitesInput,
} from "@/lib/ai/palpites/cartridges/cartridge";

// Função PURA — sem DB, sem LLM. Montamos output/input mínimos à mão (os campos #379
// h2hSummary/recentScores são `.optional()` no schema, então não precisamos do builder).

function output(over: Partial<PalpiteSynthesisOutput> = {}): PalpiteSynthesisOutput {
  return {
    verdict: "Vai dar Flamengo",
    probableScore: { home: 2, away: 1 },
    firstHalfScore: { home: 1, away: 0 },
    firstToScore: "home",
    confidence: "alta",
    narrative: "O Fla vem voando em casa.",
    citedMarkets: ["Resultado (1X2)"],
    ...over,
  };
}

function input(over: Partial<PalpitesInput> = {}): PalpitesInput {
  return {
    match: {
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: "2026-05-15T19:00:00.000Z",
    },
    analyses: [],
    homeForm: {
      team: "CR Flamengo",
      gamesConsidered: 5,
      avgGoalsFor: 1.6,
      avgGoalsAgainst: 0.8,
      results: ["W", "W", "D", "W", "L"],
    },
    awayForm: {
      team: "Fluminense FC",
      gamesConsidered: 5,
      avgGoalsFor: 1.0,
      avgGoalsAgainst: 1.4,
      results: ["L", "D", "L", "W", "D"],
    },
    h2h: [],
    news: [],
    h2hSummary: {
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      homeWins: 3,
      awayWins: 1,
      draws: 1,
      gamesConsidered: 5,
      sequence: ["home_win", "draw", "home_win", "away_win", "home_win"],
    },
    homeRecentScores: {
      team: "CR Flamengo",
      gamesConsidered: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      goalsFor: 8,
      goalsAgainst: 4,
    },
    awayRecentScores: {
      team: "Fluminense FC",
      gamesConsidered: 5,
      wins: 1,
      draws: 2,
      losses: 2,
      goalsFor: 5,
      goalsAgainst: 7,
    },
    ...over,
  };
}

describe("checkFidelity — contagem de confrontos H2H", () => {
  it("manchete cita 'Em 5 confrontos' e gamesConsidered=5 → ok", () => {
    const r = checkFidelity(
      output({ narrative: "Em 5 confrontos diretos o Fla domina." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("manchete cita 'Em 3 confrontos' mas gamesConsidered=5 → contradição (fail + reason)", () => {
    const r = checkFidelity(
      output({ narrative: "Em 3 confrontos diretos o Fla domina." }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("h2h.gamesConsidered");
      expect(r.reason).toContain("3");
      expect(r.reason).toContain("5");
    }
  });

  it("contagem de confrontos no VERDICT (não só narrative) também é checada", () => {
    const r = checkFidelity(
      output({ verdict: "Em 2 confrontos, o Fla sempre venceu" }),
      input(),
    );
    expect(r.ok).toBe(false);
  });
});

describe("checkFidelity — totais de gols (marcados / sofridos)", () => {
  it("'8 gols marcados' bate com homeRecentScores.goalsFor=8 → ok", () => {
    const r = checkFidelity(
      output({ narrative: "O Fla fez 8 gols marcados nos últimos jogos." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("'5 gols marcados' bate com awayRecentScores.goalsFor=5 (outro lado) → ok", () => {
    const r = checkFidelity(
      output({ narrative: "Time visitante com 5 gols marcados recentes." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("'12 gols marcados' não bate com NENHUM lado ([8,5]) → contradição", () => {
    const r = checkFidelity(
      output({ narrative: "Ataque pegando fogo: 12 gols marcados." }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("goalsFor");
  });

  it("'7 gols sofridos' bate com awayRecentScores.goalsAgainst=7 → ok", () => {
    const r = checkFidelity(
      output({ narrative: "A defesa cedeu 7 gols sofridos." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("'9 gols sofridos' não bate com nenhum lado ([4,7]) → contradição", () => {
    const r = checkFidelity(
      output({ narrative: "Defesa frágil: 9 gols sofridos no período." }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("goalsAgainst");
  });
});

describe("checkFidelity — omissão e ausência de fato (postura inegociável)", () => {
  it("manchete SEM nenhuma contagem citada → ok (omissão ≠ contradição)", () => {
    const r = checkFidelity(
      output({ narrative: "O Fla vem voando em casa e o Flu sofre fora." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("h2hSummary ausente (input montado à mão) + manchete cita confrontos → ok (não fabrica falha)", () => {
    const r = checkFidelity(
      output({ narrative: "Em 99 confrontos o Fla domina." }),
      input({ h2hSummary: undefined }),
    );
    expect(r.ok).toBe(true);
  });

  it("recentScores ausentes + manchete cita gols → ok (não fabrica falha)", () => {
    const r = checkFidelity(
      output({ narrative: "Fez 99 gols marcados e 99 gols sofridos." }),
      input({ homeRecentScores: undefined, awayRecentScores: undefined }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("checkFidelity — robustez (NUNCA lança)", () => {
  it("narrativa malformada/lixo → não lança, retorna ok", () => {
    expect(() =>
      checkFidelity(
        output({
          verdict: "%%% $$$ ### confronto gols",
          narrative: "em em em gols gols sofridos marcados 1x2x3",
        }),
        input(),
      ),
    ).not.toThrow();
    const r = checkFidelity(
      output({ narrative: "número gigante: 999999999999999999 gols marcados" }),
      input(),
    );
    // 999999999999999999 não está em [8,5] → contradição esperada, mas SEM throw.
    expect(typeof r.ok).toBe("boolean");
  });

  it("contagem zero ('Em 0 confrontos') vs gamesConsidered=0 → ok", () => {
    const r = checkFidelity(
      output({ narrative: "Em 0 confrontos recentes, sem histórico." }),
      input({
        h2hSummary: {
          homeTeam: "CR Flamengo",
          awayTeam: "Fluminense FC",
          homeWins: 0,
          awayWins: 0,
          draws: 0,
          gamesConsidered: 0,
          sequence: [],
        },
      }),
    );
    expect(r.ok).toBe(true);
  });
});
