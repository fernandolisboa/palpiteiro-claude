import { describe, expect, it } from "vitest";

import {
  buildLiveStamp,
  liveColumns,
  liveStampFromState,
  readLiveStamp,
  type LiveStampInput,
} from "@/lib/live/stamp";

const INPUT: LiveStampInput = {
  source: "api_football",
  status: "2H",
  elapsed: 63,
  extra: null,
  minuteLabel: "63'",
  score: { home: 1, away: 0 },
  red: { home: 0, away: 1 },
  fetchedAt: new Date("2026-10-15T20:10:00Z"),
  recordedAt: new Date("2026-10-15T20:10:20Z"),
};

describe("buildLiveStamp (escrita)", () => {
  it("serializa os instantes em ISO e põe a versão", () => {
    expect(buildLiveStamp(INPUT)).toEqual({
      v: 1,
      source: "api_football",
      status: "2H",
      elapsed: 63,
      extra: null,
      minuteLabel: "63'",
      score: { home: 1, away: 0 },
      red: { home: 0, away: 1 },
      fetchedAt: "2026-10-15T20:10:00.000Z",
      recordedAt: "2026-10-15T20:10:20.000Z",
    });
  });

  it("carimbo de relógio (bolão sem minuto do provider)", () => {
    const s = buildLiveStamp({
      source: "clock",
      status: null,
      elapsed: null,
      extra: null,
      minuteLabel: null,
      score: null,
      red: null,
      fetchedAt: null,
      recordedAt: new Date("2026-10-15T19:08:00Z"),
    });
    expect(s.source).toBe("clock");
    expect(s.fetchedAt).toBeNull();
  });

  it("leva as entradas do modelo em jogo", () => {
    const s = buildLiveStamp({
      ...INPUT,
      inPlay: {
        liveModelVersion: "live_model_v1",
        r: 0.35,
        muHome: 0.49,
        muAway: 0.385,
        multipliers: { home: 1.25, away: 0.7 },
        preMatch: {
          source: "dixon_coles",
          lambdaHome: 1.4,
          lambdaAway: 1.1,
          rho: -0.1,
          baseCheckedAt: new Date("2026-10-15T13:30:00Z"),
        },
      },
    });
    expect(s.inPlay?.preMatch.baseCheckedAt).toBe("2026-10-15T13:30:00.000Z");
    expect(s.inPlay?.r).toBe(0.35);
  });

  it("lança em entrada inválida (bug nosso não vai pro banco)", () => {
    expect(() =>
      buildLiveStamp({ ...INPUT, score: { home: -1, away: 0 } })
    ).toThrow();
    expect(() => buildLiveStamp({ ...INPUT, elapsed: 1.5 })).toThrow();
  });
});

describe("readLiveStamp (leitura, nunca lança)", () => {
  it("ida e volta", () => {
    const s = buildLiveStamp(INPUT);
    expect(readLiveStamp(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "63'"],
    ["versão desconhecida", { ...buildLiveStamp(INPUT), v: 2 }],
    ["placar quebrado", { ...buildLiveStamp(INPUT), score: { home: "1" } }],
    ["sem recordedAt", { ...buildLiveStamp(INPUT), recordedAt: undefined }],
  ])("%s → null", (_label, raw) => {
    expect(readLiveStamp(raw)).toBeNull();
  });
});

describe("liveColumns", () => {
  it("sem carimbo = pré-jogo; com carimbo = ao vivo (casa com o CHECK)", () => {
    expect(liveColumns(null)).toEqual({ isLive: false, liveState: null });
    const s = buildLiveStamp(INPUT);
    expect(liveColumns(s)).toEqual({ isLive: true, liveState: s });
  });
});

describe("liveStampFromState (registro ao vivo, #592)", () => {
  const state = {
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 1 },
    fetchedAt: new Date("2026-10-15T20:10:00Z"),
  };
  const recordedAt = new Date("2026-10-15T20:10:20Z");

  it("sem modelo: só o momento, fonte do provider", () => {
    expect(liveStampFromState(state, recordedAt)).toEqual(buildLiveStamp(INPUT));
  });

  it("com modelo: leva as entradas do modelo em jogo", () => {
    const stamp = liveStampFromState(state, recordedAt, {
      liveModelVersion: "inplay_v1",
      r: 0.3,
      muHome: 0.4,
      muAway: 0.3,
      multipliers: { home: 1.1, away: 0.8 },
      preMatch: {
        source: "base",
        lambdaHome: 1.4,
        lambdaAway: 1.1,
        rho: -0.05,
        baseCheckedAt: null,
      },
    });
    expect(stamp.inPlay?.liveModelVersion).toBe("inplay_v1");
    expect(stamp.inPlay?.muHome).toBe(0.4);
    expect(readLiveStamp(stamp)).toEqual(stamp);
  });
});
