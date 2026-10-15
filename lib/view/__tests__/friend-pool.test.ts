import { describe, expect, it } from "vitest";

import {
  joinNames,
  poolBetLabel,
  poolBetShortLabel,
  poolBetsDeadlineLabel,
  poolClosesIn,
  poolEntryStampLabel,
  poolMatchLabel,
  poolPickerLabel,
  poolStatusView,
  poolWinnerStampLabel,
} from "@/lib/view/friend-pool";
import { buildLiveStamp } from "@/lib/live/stamp";
import { teamPair } from "@/lib/view/team";

const teams = { home: "Flamengo", away: "Palmeiras" };

describe("poolBetLabel", () => {
  it.each([
    ["exact_score", { home: 2, away: 1 }, "Flamengo 2 × 1 Palmeiras"],
    ["match_result", { selection: "away" }, "Vitória do Palmeiras"],
    ["match_result", { selection: "draw" }, "Empate"],
    ["double_chance", { selection: "home_draw" }, "Flamengo ou empate"],
    ["btts", { selection: "yes" }, "Os dois times marcam"],
    ["over_under", { selection: "over", line: 2.5 }, "Mais de 2,5 gols"],
  ] as const)("%s %j", (kind, params, label) => {
    expect(poolBetLabel(kind, params, teams)).toBe(label);
  });
});

describe("poolMatchLabel", () => {
  it("jogo, competição, data e hora", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const label = poolMatchLabel(
      {
        homeTeam: "Flamengo",
        awayTeam: "Palmeiras",
        league: "brasileirao_a",
        kickoffAt: new Date("2026-10-18T19:00:00Z"),
      },
      now,
      "America/Sao_Paulo",
    );
    expect(label).toBe("Flamengo × Palmeiras · Brasileirão · dom, 18 out, 16:00");
  });

  it("usa o nome curto, não o canonical (#578)", () => {
    const label = poolMatchLabel(
      {
        homeTeam: "SE Palmeiras",
        awayTeam: "SC Corinthians Paulista",
        league: "brasileirao_a",
        kickoffAt: new Date("2026-10-18T19:00:00Z"),
      },
      new Date("2026-10-13T12:00:00Z"),
      "America/Sao_Paulo",
    );
    expect(label.startsWith("Palmeiras × Corinthians · ")).toBe(true);
  });
});

describe("poolBetShortLabel (#577)", () => {
  const codes = { home: "FLA", away: "PAL" };

  it("placar com as siglas", () => {
    expect(poolBetShortLabel("exact_score", { home: 2, away: 1 }, teams, codes)).toBe(
      "FLA 2 × 1 PAL",
    );
  });

  it("sigla repetida sai desempatada pelo teamPair", () => {
    // Palmeiras × Palestino: as duas derivariam "PAL".
    const pair = teamPair("Palmeiras", "Palestino", "lib");
    const tied = { home: pair.home.short, away: pair.away.short };
    const label = poolBetShortLabel("exact_score", { home: 0, away: 0 }, teams, tied);
    expect(label).toBe("PAL 0 × 0 PLS");
  });

  it.each([
    ["match_result", { selection: "away" }],
    ["double_chance", { selection: "home_draw" }],
    ["btts", { selection: "no" }],
    ["over_under", { selection: "over", line: 2.5 }],
  ] as const)("%s igual ao poolBetLabel", (kind, params) => {
    expect(poolBetShortLabel(kind, params, teams, codes)).toBe(poolBetLabel(kind, params, teams));
  });
});

describe("poolStatusView (#577)", () => {
  const NOW = new Date("2026-10-18T15:00:00Z");
  const noManual = { manualHomeScore: null, manualAwayScore: null };
  const match = (over: Partial<{ status: string; kickoffAt: Date; homeScore: number | null; awayScore: number | null }> = {}) => ({
    status: "scheduled",
    kickoffAt: new Date(NOW.getTime() + 24 * 3_600_000),
    homeScore: null,
    awayScore: null,
    ...over,
  });

  it("aberto e longe da trava: destaque, sem hora", () => {
    expect(poolStatusView({ pool: noManual, match: match() }, NOW)).toEqual({
      label: "apostas abertas",
      tone: "open",
    });
  });

  it("aberto nas últimas 3h: âmbar com quanto falta", () => {
    const kickoffAt = new Date(NOW.getTime() + 2 * 3_600_000 + 10 * 60_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "fecham em 2h 10min",
      tone: "soon",
    });
  });

  it("último minuto antes da trava: 'fecham em menos de 1min', nunca 'em 0min'", () => {
    const kickoffAt = new Date(NOW.getTime() + 59_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "fecham em menos de 1min",
      tone: "soon",
    });
    expect(poolClosesIn(kickoffAt, NOW)).toBe("em menos de 1min");
  });

  it("3h exatas já conta; 3h01 ainda não", () => {
    const at = (ms: number) => match({ kickoffAt: new Date(NOW.getTime() + ms) });
    expect(poolStatusView({ pool: noManual, match: at(3 * 3_600_000) }, NOW).tone).toBe("soon");
    expect(poolStatusView({ pool: noManual, match: at(3 * 3_600_000 + 60_000) }, NOW).tone).toBe(
      "open",
    );
  });

  it("placar conhecido (do jogo ou lançado): neutro", () => {
    expect(
      poolStatusView(
        { pool: noManual, match: match({ status: "finished", homeScore: 3, awayScore: 1 }) },
        NOW,
      ),
    ).toEqual({ label: "placar 3 × 1", tone: "neutral" });
    expect(
      poolStatusView({ pool: { manualHomeScore: 0, manualAwayScore: 2 }, match: match() }, NOW),
    ).toEqual({ label: "placar 0 × 2", tone: "neutral" });
  });

  it.each([
    ["postponed", "jogo adiado"],
    ["cancelled", "jogo cancelado"],
  ])("%s: neutro", (status, label) => {
    expect(poolStatusView({ pool: noManual, match: match({ status }) }, NOW)).toEqual({
      label,
      tone: "neutral",
    });
  });

  it("apitado sem placar: esperando o placar", () => {
    const kickoffAt = new Date(NOW.getTime() - 3_600_000);
    expect(poolStatusView({ pool: noManual, match: match({ kickoffAt }) }, NOW)).toEqual({
      label: "esperando o placar",
      tone: "neutral",
    });
  });
});

describe("joinNames", () => {
  it.each([
    [[], ""],
    [["Ana"], "Ana"],
    [["Ana", "Bia"], "Ana e Bia"],
    [["Ana", "Bia", "Caio"], "Ana, Bia e Caio"],
  ])("%j", (names, out) => {
    expect(joinNames(names)).toBe(out);
  });
});

describe("selos do bolão ao vivo (#580)", () => {
  const KICKOFF = new Date("2026-10-18T19:00:00Z");
  const at = (min: number) => new Date(KICKOFF.getTime() + min * 60_000);
  const noManual = { manualHomeScore: null, manualAwayScore: null };
  const scheduled = { status: "scheduled", kickoffAt: KICKOFF, homeScore: null, awayScore: null };
  const live = (statusShort: string, elapsed: number | null, fetchedAt: Date) => ({
    statusShort,
    elapsed,
    extra: null,
    fetchedAt,
  });
  const TZ = "America/Sao_Paulo";

  it("ao vivo com minuto: 'fecham aos 15''", () => {
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(10), {
        liveMode: true,
        state: live("1H", 10, at(10)),
      }),
    ).toEqual({ label: "fecham aos 15'", tone: "soon" });
  });

  it("ao vivo sem minuto: 'fecham em 8 min' pelo relógio", () => {
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(7), { liveMode: true }),
    ).toEqual({ label: "fecham em 8 min", tone: "soon" });
    // Último minuto: nunca "em 0 min".
    expect(
      poolBetsDeadlineLabel({ betsClosedAt: null }, scheduled, new Date(at(15).getTime() - 10_000), {
        liveMode: true,
      }),
    ).toBe("fecham em 1 min");
  });

  it("dono fechou: 'fechadas por você', neutro (antes ou depois do apito)", () => {
    const pool = { ...noManual, betsClosedAt: at(-20) };
    expect(poolStatusView({ pool, match: scheduled }, at(-10), { liveMode: true })).toEqual({
      label: "fechadas por você",
      tone: "neutral",
    });
    expect(poolStatusView({ pool, match: scheduled }, at(30), { liveMode: true }).label).toBe(
      "fechadas por você",
    );
  });

  it("admin estendeu: 'estendidas até 17:40' no fuso do usuário", () => {
    const pool = { ...noManual, betsExtendedUntil: new Date("2026-10-18T20:40:00Z") };
    expect(
      poolStatusView({ pool, match: scheduled }, at(60), {
        liveMode: true,
        state: live("2H", 58, at(60)),
        timeZone: TZ,
      }),
    ).toEqual({ label: "estendidas até 17:40", tone: "soon" });
  });

  it("estendido mas o jogo acabou: esperando o placar", () => {
    const pool = { ...noManual, betsExtendedUntil: at(150) };
    expect(
      poolStatusView({ pool, match: scheduled }, at(115), {
        liveMode: true,
        state: live("FT", 90, at(112)),
      }).label,
    ).toBe("esperando o placar");
  });

  it("pré-jogo com o modo ao vivo, nas últimas 3h: 'fecham aos 15''", () => {
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(-60), { liveMode: true }),
    ).toEqual({ label: "fecham aos 15'", tone: "soon" });
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(-24 * 60), { liveMode: true }),
    ).toEqual({ label: "apostas abertas", tone: "open" });
  });

  it("depois do corte: esperando o placar", () => {
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(20), {
        liveMode: true,
        state: live("1H", 20, at(20)),
      }).label,
    ).toBe("esperando o placar");
  });

  it("flag OFF = hoje: contagem até o apito, e fechado depois dele", () => {
    expect(poolStatusView({ pool: noManual, match: scheduled }, at(-60)).label).toBe(
      "fecham em 1h 00min",
    );
    expect(
      poolStatusView({ pool: noManual, match: scheduled }, at(5), {
        liveMode: false,
        state: live("1H", 5, at(5)),
      }).label,
    ).toBe("esperando o placar");
    // A extensão não vale com a flag desligada.
    const pool = { ...noManual, betsExtendedUntil: at(60) };
    expect(poolStatusView({ pool, match: scheduled }, at(30)).label).toBe("esperando o placar");
  });
});

describe("carimbo das apostas ao vivo (#580)", () => {
  const KICKOFF = new Date("2026-10-18T19:00:00Z");
  const at = (min: number) => new Date(KICKOFF.getTime() + min * 60_000);
  const api = (over: Partial<Parameters<typeof buildLiveStamp>[0]> = {}) =>
    buildLiveStamp({
      source: "api_football",
      status: "1H",
      elapsed: 12,
      extra: null,
      minuteLabel: "12'",
      score: { home: 0, away: 0 },
      red: null,
      fetchedAt: at(12),
      recordedAt: at(12),
      ...over,
    });
  const clock = buildLiveStamp({
    source: "clock",
    status: null,
    elapsed: null,
    extra: null,
    minuteLabel: null,
    score: null,
    red: null,
    fetchedAt: null,
    recordedAt: new Date(at(12).getTime() + 40_000),
  });
  const entry = (liveState: unknown) => ({ isLive: true, liveState });

  it("lista: 'aos 12' · 0–0'", () => {
    expect(poolEntryStampLabel(entry(api()), KICKOFF)).toBe("aos 12' · 0–0");
    expect(
      poolEntryStampLabel(entry(api({ status: "HT", minuteLabel: "intervalo", score: { home: 1, away: 0 } })), KICKOFF),
    ).toBe("no intervalo · 1–0");
    expect(poolEntryStampLabel(entry(api({ score: null })), KICKOFF)).toBe("aos 12'");
  });

  it("relógio: minutos desde o apito, sem placar", () => {
    expect(poolEntryStampLabel(entry(clock), KICKOFF)).toBe("12 min após o apito");
  });

  it("aposta de antes do apito: sem carimbo; carimbo ilegível: 'ao vivo'", () => {
    expect(poolEntryStampLabel({ isLive: false, liveState: null }, KICKOFF)).toBeNull();
    expect(poolEntryStampLabel(entry({ v: 9 }), KICKOFF)).toBe("ao vivo");
  });

  it("linha do ganhador: 'acertou · anotada aos 12', 1–0'", () => {
    expect(
      poolWinnerStampLabel(entry(api({ score: { home: 1, away: 0 } })), KICKOFF),
    ).toBe("acertou · anotada aos 12', 1–0");
    expect(poolWinnerStampLabel(entry(clock), KICKOFF)).toBe(
      "acertou · anotada 12 min após o apito",
    );
    expect(poolWinnerStampLabel(entry("lixo"), KICKOFF)).toBe("acertou · anotada ao vivo");
    expect(poolWinnerStampLabel({ isLive: false, liveState: null }, KICKOFF)).toBeNull();
  });

  it("seletor do Novo bolão: 'ao vivo' depois do apito", () => {
    const m = {
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
      league: "brasileirao_a" as const,
      kickoffAt: KICKOFF,
    };
    expect(poolPickerLabel(m, at(5), "America/Sao_Paulo").endsWith(" · ao vivo")).toBe(true);
    expect(poolPickerLabel(m, at(-5), "America/Sao_Paulo")).toBe(
      poolMatchLabel(m, at(-5), "America/Sao_Paulo"),
    );
  });
});
