import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { H2HSection } from "@/components/h2h-section";
import { MatchRow } from "@/components/match-row";
import { CravouTag } from "@/components/palpites/palpite-badges";

import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_MAX_AGE_MS } from "@/lib/model-base/version";
import { toMatchHeroView, toMatchRowView, type MatchInput } from "@/lib/view/match";
import {
  exactScoreLegQuip,
  exactScoreQuip,
  freguesiaLine,
  freguesiaStreak,
  isChocolate,
  isRetaFinal,
  isZebra,
  matchRowTags,
  modelFreshAtKickoff,
  poolEntryQuip,
  poolNoWinnerLine,
  readScore,
  underdogSide,
} from "@/lib/view/match-tags";
import { toH2HView, withDisplayTeamNames } from "@/lib/view/sections";
import type { NormalizedH2H } from "@/lib/providers/sports-data/types";

// Etiquetas de mesa de amigos (ADR 0070 §7, #656): cada regra em código, com teste.

const probs = (home: number, draw: number, away: number) => ({ home, draw, away });
const TEAMS = { home: "PAL", away: "FLA" };

describe("zebra", () => {
  it("resultado com menos de 20% na base", () => {
    expect(isZebra(probs(70, 19.9, 10.1), { home: 1, away: 1 })).toBe(true);
    expect(isZebra(probs(70, 20, 10), { home: 0, away: 2 })).toBe(true);
    expect(isZebra(probs(70, 20, 10), { home: 1, away: 1 })).toBe(false); // 20 não é < 20
    expect(isZebra(probs(70, 20, 10), { home: 3, away: 0 })).toBe(false);
  });

  it("a base só vale se foi conferida até 24h antes do apito", () => {
    const kickoff = new Date("2026-11-01T19:00:00Z");
    const before = (ms: number) => new Date(kickoff.getTime() - ms);
    expect(modelFreshAtKickoff(before(3_600_000), kickoff)).toBe(true);
    expect(modelFreshAtKickoff(before(MATCH_MODEL_MAX_AGE_MS), kickoff)).toBe(true);
    expect(modelFreshAtKickoff(before(MATCH_MODEL_MAX_AGE_MS + 1), kickoff)).toBe(false);
    // Depois do apito não é leitura de antes do jogo.
    expect(modelFreshAtKickoff(before(-60_000), kickoff)).toBe(false);
  });
});

describe("azarão", () => {
  it("o lado com menos de 20% de vitória; o menor se os dois", () => {
    expect(underdogSide(probs(72, 18, 10))).toBe("away");
    expect(underdogSide(probs(12, 20, 68))).toBe("home");
    expect(underdogSide(probs(45, 30, 25))).toBeNull();
    expect(underdogSide(probs(15, 70, 15))).toBe("home");
    expect(underdogSide(probs(19, 70, 11))).toBe("away");
  });
});

describe("chocolate e reta final", () => {
  it("chocolate: 3 gols ou mais de diferença, pros dois lados", () => {
    expect(isChocolate({ home: 3, away: 0 })).toBe(true);
    expect(isChocolate({ home: 1, away: 5 })).toBe(true);
    expect(isChocolate({ home: 3, away: 1 })).toBe(false);
  });

  it("reta final: 2º tempo do minuto 80 em diante", () => {
    expect(isRetaFinal({ statusShort: "2H", elapsed: 80 })).toBe(true);
    expect(isRetaFinal({ statusShort: "2H", elapsed: 90 })).toBe(true);
    expect(isRetaFinal({ statusShort: "2H", elapsed: 79 })).toBe(false);
    expect(isRetaFinal({ statusShort: "2H", elapsed: null })).toBe(false);
    expect(isRetaFinal({ statusShort: "ET", elapsed: 95 })).toBe(false);
    expect(isRetaFinal({ statusShort: "HT", elapsed: 45 })).toBe(false);
  });
});

describe("matchRowTags", () => {
  it("só entra a regra cujo insumo veio", () => {
    expect(matchRowTags({ teams: TEAMS })).toEqual([]);
    expect(
      matchRowTags({ teams: TEAMS, finalScore: { home: 4, away: 0 } }).map((t) => t.key),
    ).toEqual(["chocolate"]);
    expect(
      matchRowTags({
        teams: TEAMS,
        finalScore: { home: 0, away: 3 },
        resultModel: probs(75, 15, 10),
      }).map((t) => t.label),
    ).toEqual(["deu zebra", "chocolate"]);
    expect(
      matchRowTags({ teams: TEAMS, pregameModel: probs(75, 15, 10) }).map((t) => t.label),
    ).toEqual(["azarão: FLA"]);
    expect(
      matchRowTags({ teams: TEAMS, live: { statusShort: "2H", elapsed: 84 } }),
    ).toEqual([{ key: "reta_final", label: "reta final", title: "Do minuto 80 em diante" }]);
  });
});

describe("cravou e na trave", () => {
  it("placar exato: 0 gol de distância cravou, 1 na trave, mais nada", () => {
    expect(exactScoreQuip({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe("cravou");
    expect(exactScoreQuip({ home: 2, away: 1 }, { home: 2, away: 2 })).toBe("na_trave");
    expect(exactScoreQuip({ home: 2, away: 1 }, { home: 1, away: 1 })).toBe("na_trave");
    expect(exactScoreQuip({ home: 2, away: 1 }, { home: 1, away: 2 })).toBeNull();
    expect(exactScoreQuip({ home: 2, away: 1 }, { home: 0, away: 0 })).toBeNull();
  });

  it("readScore lê params e resultData; incompleto é null", () => {
    expect(readScore({ home: 2, away: 0 })).toEqual({ home: 2, away: 0 });
    expect(readScore({ homeScore: 1, awayScore: 3, totalGoals: 4 })).toEqual({ home: 1, away: 3 });
    expect(readScore({ homeScore: null, awayScore: null })).toBeNull();
    expect(readScore({ selection: "over" })).toBeNull();
    expect(readScore(null)).toBeNull();
    // params do placar exato usam home/away; essas chaves vencem se as duas vierem.
    expect(readScore({ home: 1, away: 0, homeScore: 5, awayScore: 5 })).toEqual({ home: 1, away: 0 });
  });

  it("Suas apostas: só placar exato decidido, contra o placar da liquidação", () => {
    const leg = (result: string, resultData: unknown, kind = "exact_score") => ({
      kind,
      params: { home: 2, away: 1 },
      outcome: { result, resultData },
    });
    expect(exactScoreLegQuip(leg("won", null))).toBe("Cravou o placar.");
    expect(exactScoreLegQuip(leg("lost", { homeScore: 2, awayScore: 2 }))).toBe("Ficou na trave.");
    expect(exactScoreLegQuip(leg("lost", { homeScore: 0, awayScore: 2 }))).toBeNull();
    expect(exactScoreLegQuip(leg("lost", null))).toBeNull();
    expect(exactScoreLegQuip(leg("won", null, "match_result"))).toBeNull();
    expect(exactScoreLegQuip({ kind: "exact_score", params: { home: 2, away: 1 }, outcome: null })).toBeNull();
  });

  it("bolão: o chute de placar contra o placar que decidiu o bolão", () => {
    const score = { home: 1, away: 0 };
    expect(poolEntryQuip("exact_score", { home: 1, away: 0 }, score)).toBe("Cravou o placar.");
    expect(poolEntryQuip("exact_score", { home: 1, away: 1 }, score)).toBe("Ficou na trave.");
    expect(poolEntryQuip("exact_score", { home: 3, away: 0 }, score)).toBeNull();
    expect(poolEntryQuip("match_result", { selection: "home" }, score)).toBeNull();
  });

  it("bolão sem ganhador: zebra só quando era improvável", () => {
    expect(poolNoWinnerLine(true)).toBe("Deu zebra: ninguém acertou.");
    expect(poolNoWinnerLine(false)).toBe("Ninguém acertou dessa vez.");
  });
});

describe("freguesia", () => {
  const r = (homeTeam: string, home: number, away: number, awayTeam: string) => ({
    homeTeam,
    awayTeam,
    home,
    away,
  });

  it("4 vitórias ou mais, contando o time nos dois mandos", () => {
    expect(
      freguesiaStreak([
        r("Palmeiras", 2, 0, "Santos"),
        r("Santos", 0, 1, "Palmeiras"),
        r("Palmeiras", 1, 1, "Santos"),
        r("Palmeiras", 3, 2, "Santos"),
        r("Santos", 1, 2, "Palmeiras"),
      ]),
    ).toEqual({ team: "Palmeiras", wins: 4, played: 5 });
    expect(
      freguesiaStreak([
        r("Palmeiras", 2, 0, "Santos"),
        r("Santos", 2, 1, "Palmeiras"),
        r("Palmeiras", 1, 0, "Santos"),
        r("Palmeiras", 3, 2, "Santos"),
        r("Santos", 1, 1, "Palmeiras"),
      ]),
    ).toBeNull();
    // Menos de 4 confrontos com placar: pouco pra chamar de freguesia.
    expect(
      freguesiaStreak([r("A", 1, 0, "B"), r("A", 2, 0, "B"), r("B", 0, 1, "A")]),
    ).toBeNull();
  });

  it("a frase", () => {
    expect(freguesiaLine({ team: "Palmeiras", wins: 4, played: 5 })).toBe(
      "Freguesia: Palmeiras venceu 4 dos últimos 5 confrontos.",
    );
    expect(freguesiaLine({ team: "Palmeiras", wins: 4, played: 4 })).toBe(
      "Freguesia: Palmeiras venceu os últimos 4 confrontos.",
    );
  });

  it("toH2HView carrega a freguesia e a borda de tela troca o nome", () => {
    const fx = (i: number, homeTeam: string, h: number, a: number, awayTeam: string) =>
      ({
        kickoffTimestampMs: Date.UTC(2026, 0, 1) - i * 86_400_000,
        homeTeam,
        awayTeam,
        score: { home: h, away: a },
      }) as unknown as NormalizedH2H;
    const h2h = [
      fx(0, "Palmeiras", 2, 0, "Santos"),
      fx(1, "Santos", 0, 1, "Palmeiras"),
      fx(2, "Palmeiras", 2, 1, "Santos"),
      fx(3, "Palmeiras", 3, 2, "Santos"),
      fx(4, "Santos", 1, 1, "Palmeiras"),
    ];
    const view = toH2HView(h2h, 5);
    expect(view.streak).toEqual({ team: "Palmeiras", wins: 4, played: 5 });
    const shown = withDisplayTeamNames(
      { home: { name: "Palmeiras", results: [] }, away: { name: "Santos", results: [] } } as never,
      view,
      "bsa",
    );
    expect(shown.h2h.streak?.team).toBe(shown.h2h.rows[0].h);
    // Sem freguesia, a chave não existe (goldens do H2H intactos).
    expect("streak" in toH2HView(h2h.slice(0, 3), 5)).toBe(false);
  });
});

describe("toMatchRowView com etiquetas", () => {
  const NOW = new Date("2026-06-11T12:00:00.000Z");
  const match = (over: Partial<MatchInput>): MatchInput => ({
    id: "11111111-1111-4111-8111-111111111111",
    league: "brasileirao_a",
    homeTeam: "Palmeiras",
    awayTeam: "Flamengo",
    kickoffAt: new Date("2026-06-11T18:00:00.000Z"),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...over,
  });
  const snapshot = (checkedAt: Date, mr = probs(72, 18, 10)) =>
    ({
      checkedAt,
      probabilities: {
        match_result: mr,
        double_chance: { home_or_draw: 90, away_or_draw: 28, home_or_away: 82 },
        btts: { yes: 50, no: 50 },
        over_under: {
          "1.5": { over: 74, under: 26 },
          "2.5": { over: 45, under: 55 },
          "3.5": { over: 22, under: 78 },
        },
      },
    }) as unknown as MatchModelSnapshot;
  const row = (over: Partial<MatchInput>, extra: Partial<Parameters<typeof toMatchRowView>[0]> = {}) =>
    toMatchRowView({ match: match(over), odds: null, hasPrediction: false, now: NOW, ...extra });

  it("sem regra batendo, sem a chave", () => {
    expect("tags" in row({})).toBe(false);
    expect("tags" in row({ status: "finished", homeScore: 2, awayScore: 1, kickoffAt: new Date("2026-06-10T18:00:00Z") })).toBe(false);
  });

  it("antes do jogo: azarão pela base fresca", () => {
    const v = row({}, { modelSnapshot: snapshot(new Date(NOW.getTime() - 3_600_000)) });
    expect(v.tags?.map((t) => t.label)).toEqual([`azarão: ${v.away.short}`]);
    const stale = row({}, { modelSnapshot: snapshot(new Date(NOW.getTime() - 25 * 3_600_000)) });
    expect("tags" in stale).toBe(false);
  });

  it("encerrado: zebra pela base de antes do apito, chocolate pelo placar", () => {
    const kickoffAt = new Date("2026-06-10T18:00:00Z");
    const fresh = snapshot(new Date(kickoffAt.getTime() - 2 * 3_600_000));
    const v = row({ status: "finished", homeScore: 0, awayScore: 3, kickoffAt }, { modelSnapshot: fresh });
    expect(v.tags?.map((t) => t.key)).toEqual(["zebra", "chocolate"]);
    // Base de dias antes do apito: sem zebra, o chocolate fica.
    const old = snapshot(new Date(kickoffAt.getTime() - 3 * 86_400_000));
    expect(row({ status: "finished", homeScore: 0, awayScore: 3, kickoffAt }, { modelSnapshot: old }).tags?.map((t) => t.key)).toEqual(["chocolate"]);
    // Encerrado não ganha azarão (a base é de antes do jogo, a etiqueta é pré-jogo).
    expect(row({ status: "finished", homeScore: 1, awayScore: 0, kickoffAt }, { modelSnapshot: fresh }).tags).toBeUndefined();
  });

  it("adiado ou cancelado com placar no banco: nenhuma etiqueta de resultado", () => {
    const kickoffAt = new Date("2026-06-10T18:00:00Z");
    const fresh = snapshot(new Date(kickoffAt.getTime() - 2 * 3_600_000));
    for (const status of ["postponed", "cancelled", "live"] as const) {
      const v = row({ status, homeScore: 0, awayScore: 4, kickoffAt }, { modelSnapshot: fresh });
      expect("tags" in v, status).toBe(false);
    }
  });

  it("ao vivo: reta final só com o estado fresco do minuto 80 em diante", () => {
    const kickoffAt = new Date(NOW.getTime() - 90 * 60_000);
    const state = (elapsed: number, fetchedAgoMs = 20_000, statusShort = "2H") => ({
      statusShort,
      elapsed,
      extra: null,
      fetchedAt: new Date(NOW.getTime() - fetchedAgoMs),
      minuteLabel: `${elapsed}'`,
      score: { home: 1, away: 0 },
      red: null,
    });
    expect(row({ status: "live", kickoffAt }, { inPlay: state(82) }).tags?.map((t) => t.key)).toEqual(["reta_final"]);
    expect("tags" in row({ status: "live", kickoffAt }, { inPlay: state(70) })).toBe(false);
    // Estado velho (mais de 10 min): sem placar ao vivo, sem etiqueta.
    expect("tags" in row({ status: "live", kickoffAt }, { inPlay: state(85, 15 * 60_000) })).toBe(false);
    // O provider já deu o fim.
    expect("tags" in row({ status: "live", kickoffAt }, { inPlay: state(90, 20_000, "FT") })).toBe(false);
  });

  it("o hero não leva etiqueta (firewall ADR 0030)", () => {
    const hero = toMatchHeroView({
      match: match({}),
      odds: null,
      hasPrediction: false,
      now: NOW,
      modelSnapshot: snapshot(new Date(NOW.getTime() - 3_600_000)),
    });
    expect("tags" in hero).toBe(false);
  });
});

describe("na tela", () => {
  it("a linha do jogo mostra as etiquetas com o porquê no title", () => {
    const m = toMatchRowView({
      match: {
        id: "11111111-1111-4111-8111-111111111111",
        league: "brasileirao_a",
        homeTeam: "Palmeiras",
        awayTeam: "Flamengo",
        kickoffAt: new Date("2026-06-10T18:00:00Z"),
        status: "finished",
        homeScore: 4,
        awayScore: 0,
      },
      odds: null,
      hasPrediction: false,
      now: new Date("2026-06-11T12:00:00Z"),
    });
    const html = renderToStaticMarkup(createElement(MatchRow, { m }));
    expect(html).toContain('data-tag="chocolate"');
    expect(html).toContain('title="Vitória por 3 gols ou mais"');
  });

  it("os confrontos abrem com a freguesia", () => {
    const html = renderToStaticMarkup(
      createElement(H2HSection, {
        view: {
          rows: [{ date: "01/01", h: "Palmeiras", a: "Santos", s: "2 – 0", tag: "under" }],
          summary: "média 2,0 gols",
          streak: { team: "Palmeiras", wins: 4, played: 5 },
        },
      }),
    );
    expect(html).toContain("Freguesia: Palmeiras venceu 4 dos últimos 5 confrontos.");
  });
});

describe("cravou o placar", () => {
  it("o selo do palpite da IA ganha a etiqueta ao lado, sem trocar o selo", () => {
    const html = renderToStaticMarkup(createElement(CravouTag));
    expect(html).toContain("cravou o placar");
    expect(html).toContain('data-tag="cravou"');
  });
});
