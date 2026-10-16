import { describe, expect, it } from "vitest";

import { buildLiveStamp } from "@/lib/live/stamp";

import {
  formatLiveAge,
  heroLiveFollow,
  liveMomentLabel,
  liveStampLabel,
  toLiveScoreView,
  type LiveScoreInput,
} from "@/lib/view/live-score";

const NOW = new Date("2026-10-15T20:03:00.000Z");

function state(over: Partial<LiveScoreInput> = {}): LiveScoreInput {
  return {
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    fetchedAt: new Date(NOW.getTime() - 20_000),
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    ...over,
  };
}

describe("formatLiveAge", () => {
  it("segundos abaixo de 1 min, minutos depois", () => {
    expect(formatLiveAge(0)).toBe("há 0 s");
    expect(formatLiveAge(20_000)).toBe("há 20 s");
    expect(formatLiveAge(59_400)).toBe("há 59 s");
    expect(formatLiveAge(60_000)).toBe("há 1 min");
    expect(formatLiveAge(9 * 60_000 + 59_000)).toBe("há 9 min");
    expect(formatLiveAge(-5)).toBe("há 0 s");
  });
});

describe("liveMomentLabel", () => {
  it.each([
    ["2H", "63'", "63'"],
    ["1H", "45+2'", "45+2'"],
    ["LIVE", null, "em andamento"],
    ["HT", "intervalo", "intervalo"],
    ["NS", "0'", "aguardando o apito"],
    ["ET", null, "prorrogação"],
    ["BT", null, "prorrogação"],
    ["P", null, "pênaltis"],
    ["INT", null, "jogo interrompido"],
    ["SUSP", null, "jogo interrompido"],
    ["FT", null, "fim de jogo"],
    ["PEN", null, "fim de jogo"],
  ])("%s → %s", (statusShort, minuteLabel, expected) => {
    expect(liveMomentLabel({ statusShort, minuteLabel })).toBe(expected);
  });

  it("adiado, cancelado e código desconhecido não mostram nada", () => {
    for (const statusShort of ["PST", "CANC", "ABD", "XYZ"]) {
      expect(liveMomentLabel({ statusShort, minuteLabel: null })).toBeNull();
    }
  });
});

describe("toLiveScoreView", () => {
  it("estado fresco: placar, '63' · atualizado há 20 s' e a marca de ao vivo", () => {
    expect(toLiveScoreView(state(), NOW)).toEqual({
      home: 1,
      away: 0,
      caption: "63' · atualizado há 20 s",
      live: true,
      red: null,
      ended: false,
    });
  });

  it("expulsões só quando há alguma", () => {
    expect(
      toLiveScoreView(state({ red: { home: 1, away: 0 } }), NOW)?.red
    ).toEqual({ home: 1, away: 0 });
    expect(toLiveScoreView(state({ red: null }), NOW)?.red).toBeNull();
  });

  it("até 10 min mostra; depois, null", () => {
    const at = (ms: number) =>
      state({ fetchedAt: new Date(NOW.getTime() - ms) });
    expect(toLiveScoreView(at(10 * 60_000), NOW)?.caption).toBe(
      "63' · atualizado há 10 min"
    );
    expect(toLiveScoreView(at(10 * 60_000 + 1), NOW)).toBeNull();
  });

  it("sem placar ou com status sem rótulo → null", () => {
    expect(toLiveScoreView(state({ score: null }), NOW)).toBeNull();
    expect(toLiveScoreView(state({ statusShort: "PST" }), NOW)).toBeNull();
  });

  it("atraso no apito (NS, 0–0 do in-play-state): 'aguardando o apito', ao vivo", () => {
    expect(
      toLiveScoreView(
        state({
          statusShort: "NS",
          elapsed: null,
          minuteLabel: "0'",
          score: { home: 0, away: 0 },
        }),
        NOW
      )
    ).toMatchObject({
      home: 0,
      away: 0,
      caption: "aguardando o apito · atualizado há 20 s",
      ended: false,
    });
  });

  it("fim de jogo pelo provider marca `ended`", () => {
    const v = toLiveScoreView(
      state({ statusShort: "FT", minuteLabel: null }),
      NOW
    );
    expect(v?.ended).toBe(true);
    expect(v?.caption).toBe("fim de jogo");
  });

  it("fim do provider não envelhece: aparece depois dos 10 min (row nunca rebuscada)", () => {
    for (const statusShort of ["FT", "AET", "PEN"]) {
      const v = toLiveScoreView(
        state({
          statusShort,
          minuteLabel: null,
          fetchedAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
        }),
        NOW
      );
      expect(v).toMatchObject({ home: 1, away: 0, caption: "fim de jogo", ended: true });
    }
    // Não terminal velho segue cortado; adiado/cancelado seguem sem rótulo.
    const old = new Date(NOW.getTime() - 11 * 60_000);
    expect(toLiveScoreView(state({ fetchedAt: old }), NOW)).toBeNull();
    expect(
      toLiveScoreView(state({ statusShort: "PST", fetchedAt: old }), NOW)
    ).toBeNull();
  });
});

describe("liveStampLabel (selo do registro ao vivo)", () => {
  const base = {
    source: "api_football" as const,
    status: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: null,
    fetchedAt: NOW,
    recordedAt: NOW,
  };

  it("minuto e placar do momento do registro", () => {
    expect(liveStampLabel(buildLiveStamp(base))).toBe("ao vivo · 63' · 1–0");
  });

  it("intervalo; carimbo de relógio sem placar", () => {
    expect(
      liveStampLabel(buildLiveStamp({ ...base, status: "HT", minuteLabel: null }))
    ).toBe("ao vivo · intervalo · 1–0");
    expect(
      liveStampLabel(
        buildLiveStamp({
          ...base,
          source: "clock",
          status: null,
          minuteLabel: null,
          score: null,
          fetchedAt: null,
        })
      )
    ).toBe("ao vivo");
  });
});

describe("heroLiveFollow (cabeçalho acompanhando o jogo)", () => {
  const KICKOFF = new Date(NOW.getTime() - 63 * 60_000);
  const base = {
    liveMode: true,
    match: { status: "scheduled", kickoffAt: KICKOFF },
    state: { statusShort: "2H" },
    liveScoreShown: true,
    now: NOW,
  };
  const H = 60 * 60_000;

  it("jogo rolando com placar: acompanha, sem nota", () => {
    expect(heroLiveFollow(base)).toEqual({ note: null });
  });

  it("sem placar ao vivo dentro da janela: 'placar ao vivo indisponível'", () => {
    expect(heroLiveFollow({ ...base, state: null, liveScoreShown: false })).toEqual({
      note: "placar ao vivo indisponível",
    });
  });

  it("até kickoff + 4h acompanha; depois, null (nada mais é buscado)", () => {
    const at = (ms: number) => ({
      ...base,
      state: null,
      liveScoreShown: false,
      now: new Date(KICKOFF.getTime() + ms),
    });
    expect(heroLiveFollow(at(4 * H))).not.toBeNull();
    expect(heroLiveFollow(at(4 * H + 1))).toBeNull();
  });

  it("flag desligada, antes do apito, banco encerrado ou fim do provider: null", () => {
    expect(heroLiveFollow({ ...base, liveMode: false })).toBeNull();
    expect(
      heroLiveFollow({
        ...base,
        match: { status: "scheduled", kickoffAt: new Date(NOW.getTime() + 60_000) },
      })
    ).toBeNull();
    expect(
      heroLiveFollow({ ...base, match: { status: "finished", kickoffAt: KICKOFF } })
    ).toBeNull();
    expect(heroLiveFollow({ ...base, state: { statusShort: "FT" } })).toBeNull();
  });
});
