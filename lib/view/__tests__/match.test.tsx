import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchRow } from "@/components/match-row";
import type { MatchInput } from "@/lib/view/match";
import {
  toMatchHeroView,
  toMatchListRowView,
  toMatchRowView,
} from "@/lib/view/match";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_MAX_AGE_MS } from "@/lib/model-base/version";
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
import type { MatchStatus } from "@/lib/view/types";

// Deterministic anchor so relative time helpers don't depend on wall clock.
const NOW = new Date("2026-06-11T12:00:00.000Z");
const KICKOFF = new Date("2026-06-11T18:00:00.000Z");

function makeMatch(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    league: "world_cup",
    homeTeam: "FC Barcelona",
    awayTeam: "Real Madrid CF",
    kickoffAt: KICKOFF,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

describe("toMatchRowView scores + status", () => {
  it("maps homeScore/awayScore for a finished match", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("finished");
    expect(view.homeScore).toBe(2);
    expect(view.awayScore).toBe(1);
  });

  it("preserves a 0–0 finished score (does not collapse to null)", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: 0, awayScore: 0 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.homeScore).toBe(0);
    expect(view.awayScore).toBe(0);
  });

  it("leaves scores null for a scheduled match even if db carries digits", () => {
    const view = toMatchRowView({
      // A provider may leave stray score columns on a non-finished row; the view
      // must not surface them.
      match: makeMatch({ status: "scheduled", homeScore: 3, awayScore: 1 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("scheduled");
    expect(view.homeScore).toBeNull();
    expect(view.awayScore).toBeNull();
  });

  it("leaves scores null for live/postponed/cancelled even with digits present", () => {
    for (const status of ["live", "postponed", "cancelled"] as MatchStatus[]) {
      const view = toMatchRowView({
        match: makeMatch({ status, homeScore: 1, awayScore: 1 }),
        odds: null,
        hasPrediction: false,
        now: NOW,
      });

      expect(view.status).toBe(status);
      expect(view.homeScore).toBeNull();
      expect(view.awayScore).toBeNull();
    }
  });

  it("keeps scores null when a finished match has no reported score", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: null, awayScore: null }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("finished");
    expect(view.homeScore).toBeNull();
    expect(view.awayScore).toBeNull();
  });
});

describe("toMatchRowView — isInProgress derivation (#385)", () => {
  // Relógio fixo; o kickoff é deslocado relativo a este NOW pra exercitar a janela.
  const N = new Date("2026-06-11T12:00:00.000Z");

  function viewWith(status: MatchStatus, kickoffOffsetMs: number) {
    return toMatchRowView({
      match: makeMatch({
        status,
        kickoffAt: new Date(N.getTime() + kickoffOffsetMs),
      }),
      odds: null,
      hasPrediction: false,
      now: N,
    });
  }

  it("TRUE quando scheduled e kickoff <= now < kickoff+3h (recém-apitado, enum stale)", () => {
    const view = viewWith("scheduled", -20 * 60 * 1000); // apitou há 20min
    expect(view.isInProgress).toBe(true);
  });

  it("TRUE para status 'live' dentro da janela", () => {
    const view = viewWith("live", -30 * 60 * 1000);
    expect(view.isInProgress).toBe(true);
  });

  it("FALSE exatamente em kickoff+3h (upper-EXCLUSIVO — para de pendurar)", () => {
    // now == kickoff + IN_PROGRESS_WINDOW_MS → fora da janela.
    const view = viewWith("scheduled", -IN_PROGRESS_WINDOW_MS);
    expect(view.isInProgress).toBe(false);
  });

  it("FALSE >3h após o apito mesmo se o status ainda for 'scheduled' (cron não virou)", () => {
    const view = viewWith("scheduled", -(IN_PROGRESS_WINDOW_MS + 60 * 1000));
    expect(view.isInProgress).toBe(false);
  });

  it("FALSE antes do apito (now < kickoff)", () => {
    const view = viewWith("scheduled", +60 * 60 * 1000); // apita em 1h
    expect(view.isInProgress).toBe(false);
  });

  it("FALSE p/ finished/cancelled/postponed mesmo DENTRO da janela (exclusão explícita)", () => {
    for (const status of [
      "finished",
      "cancelled",
      "postponed",
    ] as MatchStatus[]) {
      const view = viewWith(status, -30 * 60 * 1000);
      expect(view.isInProgress).toBe(false);
    }
  });

  it("placar fica null num jogo in-progress (badge-only, sem placar fabricado)", () => {
    const view = toMatchRowView({
      match: makeMatch({
        status: "scheduled",
        kickoffAt: new Date(N.getTime() - 30 * 60 * 1000),
        homeScore: 1,
        awayScore: 0,
      }),
      odds: null,
      hasPrediction: false,
      now: N,
    });
    expect(view.isInProgress).toBe(true);
    expect(view.homeScore).toBeNull();
    expect(view.awayScore).toBeNull();
  });
});

describe("MatchRow rendering by status", () => {
  function render(match: MatchInput, odds = false) {
    const view = toMatchRowView({
      match,
      odds: odds
        ? {
            bookmaker: "bet365",
            overOdd: "1.85",
            underOdd: "1.95",
            capturedAt: NOW,
          }
        : null,
      hasPrediction: false,
      now: NOW,
    });
    return renderToStaticMarkup(<MatchRow m={view} />);
  }

  it("shows the score + 'encerrado' marker for a finished match, not odds", () => {
    const markup = render(
      makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
      true,
    );

    // Score digits and the finished marker are present.
    expect(markup).toContain(">2<");
    expect(markup).toContain(">1<");
    expect(markup.toLowerCase()).toContain("encerrado");
    // Odds chip / "sem odd" must NOT render for a finished match (score branch).
    expect(markup).not.toContain("sem odd");
    expect(markup).not.toContain("Mais de");
    expect(markup).not.toContain("Menos de");
  });

  it("renders postponed/cancelled sanely (label, not a 0–0)", () => {
    const postponed = render(makeMatch({ status: "postponed" }));
    expect(postponed).toContain("Adiado");
    expect(postponed.toLowerCase()).not.toContain("encerrado");

    const cancelled = render(makeMatch({ status: "cancelled" }));
    expect(cancelled).toContain("Cancelado");
    expect(cancelled.toLowerCase()).not.toContain("encerrado");
  });

  it("keeps odds rendering unchanged for a scheduled match", () => {
    const markup = render(makeMatch({ status: "scheduled" }), true);
    expect(markup).toContain("1,85");
    expect(markup).toContain("1,95");
    expect(markup.toLowerCase()).not.toContain("encerrado");
  });

  it("shows 'sem odd' for a scheduled match without odds", () => {
    const markup = render(makeMatch({ status: "scheduled" }), false);
    expect(markup).toContain("sem odd");
  });

  it("in-progress (scheduled apitado há 20min): 'ao vivo', SEM odds/sem odd/placar", () => {
    // kickoff no passado relativo ao NOW → isInProgress derivado = true.
    const markup = render(
      makeMatch({
        status: "scheduled",
        kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000),
      }),
      true, // odds presentes — devem ser preemptadas pelo branch ao vivo
    );
    // Um selo só (#574): AO VIVO no topo; a coluna da direita mostra "—" sem placar.
    expect(markup.split("AO VIVO")).toHaveLength(2);
    expect(markup.toLowerCase().split("ao vivo")).toHaveLength(2);
    expect(markup).toContain(">—<");
    expect(markup).not.toContain("sem odd");
    expect(markup).not.toContain("1,85");
    expect(markup.toLowerCase()).not.toContain("encerrado");
  });

  it("live >3h (isInProgress false pelo upper-bound) AINDA mostra 'ao vivo' (OR de status)", () => {
    // kickoff há 4h: isInProgress=false (upper-exclusive), mas status 'live' cru
    // mantém a badge — um jogo longo nunca cai no branch de odds (parece apostável).
    const markup = render(
      makeMatch({
        status: "live",
        kickoffAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
      }),
      true,
    );
    expect(markup).toContain("AO VIVO");
    expect(markup).not.toContain("1,85");
  });

  it("live com placar parcial (#574): placar + legenda na direita, selo uma vez", () => {
    const markup = render(
      makeMatch({
        status: "live",
        kickoffAt: new Date(NOW.getTime() - 50 * 60 * 1000),
        homeScore: 1,
        awayScore: 1,
        updatedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
      }),
      true,
    );
    expect(markup).toMatch(/1<span[^>]*>–<\/span>1/);
    expect(markup).toContain("parcial · atualizado há 2h");
    expect(markup.toLowerCase().split("ao vivo")).toHaveLength(2);
    expect(markup.toLowerCase()).not.toContain("encerrado");
    expect(markup).not.toContain("1,85");
  });

  it("scheduled futuro (isInProgress false): kickoff+odds, SEM badge ao vivo", () => {
    const markup = render(makeMatch({ status: "scheduled" }), true);
    expect(markup).toContain("1,85");
    expect(markup).not.toContain("ao vivo");
    expect(markup).not.toContain("AO VIVO");
  });
});

describe("toMatchRowView — prioridade de mercado no chip (#173 PR-2)", () => {
  const MR = {
    selections: [
      { key: "home", odd: "2.100" },
      { key: "draw", odd: "3.400" },
      { key: "away", odd: "3.900" },
    ],
  };
  const OU = {
    bookmaker: "bet365",
    overOdd: "1.85",
    underOdd: "1.95",
    capturedAt: NOW,
  };

  it("PREFERE 1X2 quando há captura h2h (3 outcomes sigla/Empate/sigla, ordem canônica)", () => {
    const view = toMatchRowView({
      match: makeMatch(),
      odds: OU,
      matchResultOdds: MR,
      hasPrediction: false,
      now: NOW,
    });
    // Coluna estreita: a sigla de 3 letras do time no lugar de "Casa"/"Fora" (#574).
    expect(view.odds?.outcomes).toEqual([
      { label: "BAR", odd: "2,10" },
      { label: "Empate", odd: "3,40" },
      { label: "RMA", odd: "3,90" },
    ]);
  });

  it("cai pro over/under quando não há captura 1X2", () => {
    const view = toMatchRowView({
      match: makeMatch(),
      odds: OU,
      matchResultOdds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.odds?.outcomes).toEqual([
      { label: "Mais de 2,5", odd: "1,85" },
      { label: "Menos de 2,5", odd: "1,95" },
    ]);
  });

  it("odds null quando ambos ausentes → 'sem odd'", () => {
    const view = toMatchRowView({
      match: makeMatch(),
      odds: null,
      matchResultOdds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.odds).toBeNull();
  });

  it("MatchRow renderiza o chip 1X2 (siglas/Empate + odds)", () => {
    const view = toMatchRowView({
      match: makeMatch(),
      odds: OU,
      matchResultOdds: MR,
      hasPrediction: false,
      now: NOW,
    });
    const markup = renderToStaticMarkup(<MatchRow m={view} />);
    expect(markup).toContain('>BAR</span> <span class="font-mono tabular-nums">2,10</span>');
    expect(markup).toContain('>Empate</span> <span class="font-mono tabular-nums">3,40</span>');
    expect(markup).toContain('>RMA</span> <span class="font-mono tabular-nums">3,90</span>');
    expect(markup).not.toContain(">Casa<");
    expect(markup).not.toContain(">Fora<");
    expect(markup).toContain("2,10");
    expect(markup).toContain("3,90");
  });
});

// Garante que o caller thread o league certo até teamToTeam (#340). O invariante
// display-only é provado no unit de teamToTeam/toStandingsView; aqui fechamos a
// fiação: uma regressão que passasse o league errado compilaria e passaria calada.
describe("toMatchRowView — nomes da Copa em PT-BR (fiação do caller)", () => {
  it("Copa: home/away viram PT-BR e league = 'wc'", () => {
    const view = toMatchRowView({
      match: makeMatch({ homeTeam: "Mexico", awayTeam: "South Korea" }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.league).toBe("wc");
    expect(view.home.name).toBe("México");
    expect(view.away.name).toBe("Coreia do Sul");
    // short/hue seguem no canonical EN (invariante de matching).
    expect(view.home.short).toBe("MEX");
  });

  it("fora da Copa: o mesmo nome passa verbatim", () => {
    const view = toMatchRowView({
      match: makeMatch({ league: "brasileirao_a", homeTeam: "Mexico" }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.league).toBe("bsa");
    expect(view.home.name).toBe("Mexico");
  });
});

describe("toMatchRowView — nome curto, sigla e escudo (#578)", () => {
  const CREST = "https://media.api-sports.io/football/teams/121.png";

  it("clube com escudo: nome curto, nome oficial, sigla e crestUrl", () => {
    const view = toMatchRowView({
      match: makeMatch({
        league: "brasileirao_a",
        homeTeam: "SE Palmeiras",
        awayTeam: "SC Corinthians Paulista",
        homeTeamCrestUrl: CREST,
        awayTeamCrestUrl: null,
      }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.home).toMatchObject({
      name: "Palmeiras",
      fullName: "SE Palmeiras",
      short: "PAL",
      crestUrl: CREST,
    });
    expect(view.away.name).toBe("Corinthians");
    expect(view.away.crestUrl).toBeUndefined();
  });

  it("sem escudo: sem crestUrl (a UI mostra as iniciais)", () => {
    const view = toMatchRowView({
      match: makeMatch({ league: "la_liga", homeTeam: "Club Atlético de Madrid", awayTeam: "Athletic Club" }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.home.crestUrl).toBeUndefined();
    expect([view.home.short, view.away.short]).toEqual(["ATM", "ATH"]);
  });

  it("Copa: a bandeira vence o escudo", () => {
    const view = toMatchRowView({
      match: makeMatch({ homeTeam: "Mexico", awayTeam: "Brazil", homeTeamCrestUrl: CREST }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(view.home.flagCode).toBe("mx");
    expect(view.home.crestUrl).toBeUndefined();
  });
});

describe("base do modelo na linha e firewall do hero (#555)", () => {
  // Base mínima com as probabilidades que a linha lê.
  const modelSnapshot = {
    checkedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    probabilities: {
      match_result: { home: 52.4, draw: 25.1, away: 22.5 },
      double_chance: { home_or_draw: 77.5, away_or_draw: 47.6, home_or_away: 74.9 },
      btts: { yes: 50, no: 50 },
      over_under: {
        "1.5": { over: 74, under: 26 },
        "2.5": { over: 45, under: 55 },
        "3.5": { over: 22, under: 78 },
      },
    },
  } as unknown as MatchModelSnapshot;

  it("analisável com base → model; sem base ou não analisável → undefined", () => {
    const withModel = toMatchRowView({
      match: makeMatch(),
      odds: null,
      hasPrediction: false,
      now: NOW,
      modelSnapshot,
    });
    expect(withModel.model).toEqual({
      favorite: { label: "BAR", pct: "52%" },
      goals25: { label: "Menos de 2,5", pct: "55%" },
    });

    expect(
      toMatchRowView({ match: makeMatch(), odds: null, hasPrediction: false, now: NOW })
        .model,
    ).toBeUndefined();
    for (const status of ["live", "finished", "postponed"] as MatchStatus[]) {
      expect(
        toMatchRowView({
          match: makeMatch({ status }),
          odds: null,
          hasPrediction: false,
          now: NOW,
          modelSnapshot,
        }).model,
      ).toBeUndefined();
    }
    // Já apitou (kickoff no passado) mesmo com status scheduled.
    expect(
      toMatchRowView({
        match: makeMatch({ kickoffAt: new Date(NOW.getTime() - 60_000) }),
        odds: null,
        hasPrediction: false,
        now: NOW,
        modelSnapshot,
      }).model,
    ).toBeUndefined();
  });

  it("base com checked_at há mais de 24h → sem linha (mesmo limite do seam do cupom)", () => {
    const at = (ageMs: number) =>
      toMatchRowView({
        match: makeMatch(),
        odds: null,
        hasPrediction: false,
        now: NOW,
        modelSnapshot: {
          ...modelSnapshot,
          checkedAt: new Date(NOW.getTime() - ageMs),
        },
      }).model;
    expect(at(MATCH_MODEL_MAX_AGE_MS)).toBeDefined();
    expect(at(MATCH_MODEL_MAX_AGE_MS + 1)).toBeUndefined();
    expect(at(25 * 3_600_000)).toBeUndefined();
  });

  it("toMatchHeroView com a base → sem a chave `model`", () => {
    const hero = toMatchHeroView({
      match: makeMatch(),
      odds: null,
      hasPrediction: false,
      now: NOW,
      modelSnapshot,
    });
    expect("model" in hero).toBe(false);
  });
});

describe("toMatchRowView — placar parcial ao vivo (#574)", () => {
  const live = (overrides: Partial<MatchInput> = {}) =>
    toMatchRowView({
      match: makeMatch({
        status: "live",
        kickoffAt: new Date(NOW.getTime() - 50 * 60 * 1000),
        homeScore: 2,
        awayScore: 0,
        ...overrides,
      }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

  it("live com placar vira liveScore; o placar final continua null", () => {
    const v = live({ updatedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) });
    expect(v.liveScore).toEqual({ home: 2, away: 0, caption: "parcial · atualizado há 2h" });
    expect(v.homeScore).toBeNull();
    expect(v.awayScore).toBeNull();
  });

  it("legenda: há menos de 1min (nunca 'há agora') e só 'parcial' sem updatedAt", () => {
    expect(live({ updatedAt: new Date(NOW.getTime() - 30_000) }).liveScore?.caption).toBe(
      "parcial · atualizado há menos de 1min",
    );
    expect(live().liveScore?.caption).toBe("parcial");
  });

  it("sem liveScore: scheduled em andamento, live sem placar, adiado/cancelado, encerrado", () => {
    const inProgress = toMatchRowView({
      match: makeMatch({ status: "scheduled", kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000) }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });
    expect(inProgress.isInProgress).toBe(true);
    expect("liveScore" in inProgress).toBe(false);
    expect("liveScore" in live({ homeScore: null })).toBe(false);
    for (const status of ["postponed", "cancelled"] as MatchStatus[]) {
      expect("liveScore" in live({ status })).toBe(false);
    }
    const finished = live({ status: "finished" });
    expect("liveScore" in finished).toBe(false);
    expect(finished.homeScore).toBe(2);
  });
});

describe("toMatchListRowView — dia, hora e contagem (#577)", () => {
  const SP = "America/Sao_Paulo";
  function listRow(kickoffAt: Date, status: MatchStatus = "scheduled") {
    return toMatchListRowView({
      match: makeMatch({ kickoffAt, status }),
      odds: null,
      hasPrediction: false,
      now: NOW,
      timeZone: SP,
    });
  }

  it("estende a MatchRowView sem mudar nenhum campo dela", () => {
    const args = {
      match: makeMatch(),
      odds: null,
      hasPrediction: true,
      now: NOW,
      timeZone: SP,
    };
    const { day, time, startsIn, ...rest } = toMatchListRowView(args);
    expect(rest).toEqual(toMatchRowView(args));
    // KICKOFF 18:00 UTC = 15:00 em São Paulo, no mesmo dia do NOW (09:00 local).
    expect(day).toEqual({ key: "2026-06-11", label: "Hoje" });
    expect(time).toBe("15:00");
    expect(startsIn).toBeUndefined();
  });

  it("contagem só nas últimas 3h (3h exatas entra, 3h01 não, passado não)", () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60 * 1000);
    expect(listRow(at(135)).startsIn).toBe("em 2h 15min");
    expect(listRow(at(40)).startsIn).toBe("em 40min");
    expect(listRow(at(180)).startsIn).toBe("em 3h 00min");
    expect("startsIn" in listRow(at(181))).toBe(false);
    expect("startsIn" in listRow(at(-5))).toBe(false);
  });

  it("adiado ou cancelado com o horário antigo nas próximas 3h não ganha contagem", () => {
    const soon = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect("startsIn" in listRow(soon, "postponed")).toBe(false);
    expect("startsIn" in listRow(soon, "cancelled")).toBe(false);
  });
});
