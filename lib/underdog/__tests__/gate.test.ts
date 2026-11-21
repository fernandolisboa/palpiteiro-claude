import { describe, expect, it } from "vitest";

import {
  findUnderdog,
  isMaterialSame,
  palpiteFavorsSide,
  underdogTeaserBlock,
  underdogTeaserVisible,
} from "@/lib/underdog/gate";
import {
  readUnderdogBase,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import { MODEL_SCORELINE_MAX_AGE_MS } from "@/lib/model-base/model-scoreline";

import { KICKOFF, NOW, snapshot } from "./fixtures";

describe("findUnderdog (porta de 8 pp)", () => {
  it("lado menos provável, chances do ponto de vista do azarão", () => {
    expect(findUnderdog({ home: 0.45, draw: 0.29, away: 0.26 })).toEqual({
      side: "away",
      chances: { underdog: 26, draw: 29, favorite: 45 },
    });
    expect(findUnderdog({ home: 0.26, draw: 0.29, away: 0.45 })?.side).toBe(
      "home"
    );
  });

  it("gap 7,99 esconde e 8 mostra", () => {
    expect(findUnderdog({ home: 0.4199, draw: 0.24, away: 0.34 })).toBeNull();
    expect(findUnderdog({ home: 0.42, draw: 0.24, away: 0.34 })).not.toBeNull();
  });

  it("empate de vitórias → null; o empate dominante não entra na regra", () => {
    expect(findUnderdog({ home: 0.3, draw: 0.4, away: 0.3 })).toBeNull();
    // 25/45/30: gap 5 → esconde; 26/29/45: gap 19 → mostra.
    expect(findUnderdog({ home: 0.25, draw: 0.45, away: 0.3 })).toBeNull();
    expect(findUnderdog({ home: 0.26, draw: 0.29, away: 0.45 })).not.toBeNull();
  });

  it("entrada inválida → null", () => {
    expect(findUnderdog({ home: Number.NaN, draw: 0.3, away: 0.2 })).toBeNull();
  });
});

describe("underdogBaseFromSnapshot: os portões da base", () => {
  it("base válida → azarão da matriz refeita", () => {
    const base = underdogBaseFromSnapshot(snapshot(), KICKOFF, NOW);
    expect(base?.pick.side).toBe("away");
    expect(base?.pick.chances.underdog).toBeGreaterThan(20);
  });

  it.each([
    ["versão diferente", snapshot({ modelVersion: "match_model_v0" }), KICKOFF],
    [
      "base velha",
      snapshot({
        checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS - 1),
      }),
      KICKOFF,
    ],
    ["jogo começado", snapshot(), NOW],
    [
      "sem azarão claro",
      snapshot({ lambdaHome: 1.2, lambdaAway: 1.15 }),
      KICKOFF,
    ],
  ] as const)("%s → null", (_l, snap, kickoff) => {
    expect(underdogBaseFromSnapshot(snap, kickoff, NOW)).toBeNull();
  });

  it("readUnderdogBase separa base indisponível de base sem azarão", () => {
    expect(readUnderdogBase(snapshot(), KICKOFF, NOW).status).toBe("ok");
    expect(
      readUnderdogBase(
        snapshot({
          checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS - 1),
        }),
        KICKOFF,
        NOW
      ).status
    ).toBe("unavailable");
    expect(
      readUnderdogBase(
        snapshot({ lambdaHome: 1.2, lambdaAway: 1.15 }),
        KICKOFF,
        NOW
      ).status
    ).toBe("no_underdog");
  });
});

describe("underdogTeaserVisible", () => {
  const pick = findUnderdog({ home: 0.45, draw: 0.29, away: 0.26 });
  const ok = {
    flag: true,
    preMatch: true,
    heroPalpite: { probableScore: { home: 1, away: 0 } },
    runInFlight: false,
    pick,
  };

  it("caso feliz", () => {
    expect(underdogTeaserVisible(ok)).toBe(true);
  });

  it.each([
    ["flag desligada", { flag: false }],
    ["fora do pré-jogo", { preMatch: false }],
    ["sem palpite", { heroPalpite: null }],
    ["run em andamento", { runInFlight: true }],
    ["sem azarão", { pick: null }],
    [
      "palpite no azarão",
      { heroPalpite: { probableScore: { home: 0, away: 1 } } },
    ],
  ] as const)("%s → esconde", (_l, over) => {
    expect(underdogTeaserVisible({ ...ok, ...over })).toBe(false);
  });

  it.each([
    ["flag", { flag: false }],
    ["not_pre", { preMatch: false }],
    ["run", { runInFlight: true }],
    ["no_pick", { pick: null }],
    ["no_palpite", { heroPalpite: null }],
    ["coherence", { heroPalpite: { probableScore: { home: 0, away: 1 } } }],
  ] as const)("underdogTeaserBlock → %s", (reason, over) => {
    expect(underdogTeaserBlock({ ...ok, ...over })).toBe(reason);
  });

  it("palpite de empate não esconde", () => {
    expect(
      underdogTeaserVisible({
        ...ok,
        heroPalpite: { probableScore: { home: 1, away: 1 } },
      })
    ).toBe(true);
  });

  it("palpiteFavorsSide", () => {
    expect(palpiteFavorsSide({ home: 2, away: 1 }, "home")).toBe(true);
    expect(palpiteFavorsSide({ home: 1, away: 1 }, "away")).toBe(false);
  });
});

describe("isMaterialSame (ADR 0073 §9)", () => {
  const stored = {
    side: "away" as const,
    chances: { underdog: 26, draw: 29, favorite: 45 },
  };
  it("mesmo lado e < 2 pp nas três → vale", () => {
    expect(
      isMaterialSame(stored, {
        side: "away",
        chances: { underdog: 27.9, draw: 28.1, favorite: 44 },
      })
    ).toBe(true);
  });
  it("2 pp numa das três, outro lado ou sem base → não vale", () => {
    expect(
      isMaterialSame(stored, {
        side: "away",
        chances: { underdog: 28, draw: 29, favorite: 43 },
      })
    ).toBe(false);
    expect(
      isMaterialSame(stored, { side: "home", chances: stored.chances })
    ).toBe(false);
    expect(isMaterialSame(stored, null)).toBe(false);
  });
});
