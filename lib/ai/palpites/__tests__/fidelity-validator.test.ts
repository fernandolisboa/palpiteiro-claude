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

describe("checkFidelity — médias e totais de outra fonte não são contradição", () => {
  // Caso de produção: totais [7, 4] e a média do visitante (4/5) no input como
  // "0.8 sofridos por jogo". A manchete repetiu a média e o "8" da casa decimal
  // reprovava o palpite.
  it("'0,8 gols sofridos por jogo' (média) não é lido como total 8 → ok", () => {
    const r = checkFidelity(
      output({ narrative: "O Flu sofre pouco: 0,8 gols sofridos por jogo." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("média com ponto ('1.6 gols marcados') também é ignorada → ok", () => {
    const r = checkFidelity(
      output({ narrative: "O Fla tem 1.6 gols marcados de média recente." }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it("média inteira ('média de 2 gols sofridos', '3 gols marcados por jogo') → ok", () => {
    const r = checkFidelity(
      output({
        narrative:
          "Média de 2 gols sofridos e o rival com 3 gols marcados por jogo.",
      }),
      input(),
    );
    expect(r.ok).toBe(true);
  });

  it.each([
    "O Flu tem 2 gols sofridos em média.",
    "O Flu tem 2 gols sofridos de média.",
    "Média: 3 gols marcados pelo Fla.",
    "O Flu leva 2 gols sofridos fora por jogo.",
    "O Fla tem média de apenas 2 gols sofridos.",
    "São 2 gols sofridos por partida.",
    "São 2 gols sofridos a cada rodada.",
    "São 2 gols sofridos/jogo.",
  ])("média inteira em outras formas ('%s') → ok", (narrative) => {
    expect(checkFidelity(output({ narrative }), input()).ok).toBe(true);
  });

  it("'N sofridos' sem 'gols', número no início e total de 2 dígitos são checados", () => {
    expect(checkFidelity(output({ narrative: "7 sofridos no período." }), input()).ok).toBe(true);
    expect(checkFidelity(output({ narrative: "9 sofridos no período." }), input()).ok).toBe(false);
    expect(
      checkFidelity(output({ narrative: "O Fla fez 10 gols marcados." }), input()).ok,
    ).toBe(false);
  });

  it("2ª citação de gols marcados errada → contradição", () => {
    const r = checkFidelity(
      output({ narrative: "O Fla tem 8 gols marcados e o Flu, 6 gols marcados." }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("6 gol(s) marcados");
  });

  it("total que o racional de uma análise já trazia (temporada) → ok", () => {
    const r = checkFidelity(
      output({ narrative: "A defesa do Flu já tem 18 gols sofridos no campeonato." }),
      input({
        analyses: [
          {
            marketKey: "match_result",
            marketLabel: "Resultado (1X2)",
            recommendation: "home",
            recommendedLabel: "Casa",
            isPass: false,
            modelProbPct: 55,
            edgePct: 3,
            confidencePct: null,
            oddAtRecommendation: 1.9,
            rationale: "Fluminense FC: 9º, 20 pts, 15 gols marcados e 18 sofridos.",
            predictionId: "pred-1",
            selections: [],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("racional só libera o total que ele traz: 19 com racional citando 18 → contradição", () => {
    const r = checkFidelity(
      output({ narrative: "A defesa do Flu já tem 19 gols sofridos no campeonato." }),
      input({
        analyses: [
          {
            marketKey: "match_result",
            marketLabel: "Resultado (1X2)",
            recommendation: "home",
            recommendedLabel: "Casa",
            isPass: false,
            modelProbPct: 55,
            edgePct: 3,
            confidencePct: null,
            oddAtRecommendation: 1.9,
            rationale: "Fluminense FC: 9º, 20 pts, 15 gols marcados e 18 sofridos.",
            predictionId: "pred-1",
            selections: [],
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("19");
  });

  it("total inventado continua reprovando mesmo com média fiel antes → contradição", () => {
    const r = checkFidelity(
      output({
        narrative: "0,8 gols sofridos por jogo, mas 9 gols sofridos no total.",
      }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("9 gol(s) sofridos");
  });

  it("checa TODAS as citações, não só a 1ª → contradição na 2ª", () => {
    const r = checkFidelity(
      output({
        narrative: "O Flu tem 7 gols sofridos e o Fla, 11 gols sofridos.",
      }),
      input(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("11");
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
