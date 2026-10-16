import { describe, expect, it } from "vitest";

import { inPlayScoreline } from "@/lib/quant/in-play";
import { pScoreline, scorelineMatrix } from "@/lib/quant/scoreline-model";
import { computeReadings } from "@/lib/user-palpite/evidence";
import { matrixFor } from "@/lib/user-palpite/lambdas";
import type { PalpiteModelBase } from "@/lib/user-palpite/model-base";
import {
  inPlayReadingFor,
  isPastScore,
  readingMatrix,
  readPalpite,
} from "@/lib/user-palpite/reading";

// Seu palpite ao vivo (#594, PLAN-580 §9.1). Landmine: a leitura pelos botões tem que
// usar a matriz FINAL condicionada ao placar atual, nunca a de pré-jogo com λ = gols já
// feitos + μ (que daria chance a placar que já passou).

const STATE = {
  statusShort: "2H",
  elapsed: 63,
  extra: null,
  fetchedAt: new Date("2026-05-15T20:10:00Z"),
  score: { home: 1, away: 0 },
  red: { home: 0, away: 1 },
};

const L = { lambdaHome: 1.6, lambdaAway: 1.0, rho: -0.08 };

describe("inPlayReadingFor", () => {
  it("placar, fração que falta e desconto por expulsão", () => {
    const ip = inPlayReadingFor(STATE)!;
    expect(ip.score).toEqual({ home: 1, away: 0 });
    expect(ip.r).toBeGreaterThan(0);
    expect(ip.r).toBeLessThan(0.5);
    // Visitante com um a menos: o mandante sobe, o visitante desce.
    expect(ip.multipliers.home).toBeGreaterThan(1);
    expect(ip.multipliers.away).toBeLessThan(1);
    expect(ip.minuteLabel).toBe("63'");
  });

  it("prorrogação e placar inválido: sem leitura", () => {
    expect(inPlayReadingFor({ ...STATE, statusShort: "ET", elapsed: 95 })).toBeNull();
    expect(inPlayReadingFor({ ...STATE, score: { home: -1, away: 0 } })).toBeNull();
  });
});

describe("readingMatrix ao vivo", () => {
  const inPlay = inPlayReadingFor(STATE)!;
  const live = readingMatrix({ ...L, inPlay });

  it("é a matriz do modelo em jogo (a mesma de inPlayScoreline), célula a célula", () => {
    const model = inPlayScoreline(
      {
        source: "dixon_coles",
        degraded: false,
        ...L,
        matrix: scorelineMatrix(L.lambdaHome, L.lambdaAway, { rho: L.rho }),
      },
      STATE,
    )!;
    expect(live.maxGoals).toBe(model.matrix.maxGoals);
    live.cells.forEach((row, h) =>
      row.forEach((p, a) => expect(p).toBeCloseTo(model.matrix.cells[h][a], 12)),
    );
  });

  it("placar abaixo do atual tem 0%; nunca a matriz de pré-jogo com λ = h0 + μ", () => {
    expect(pScoreline(live, 0, 0)).toBe(0);
    expect(pScoreline(live, 0, 1)).toBe(0);
    const muHome = L.lambdaHome * inPlay.r * inPlay.multipliers.home;
    const muAway = L.lambdaAway * inPlay.r * inPlay.multipliers.away;
    const naive = scorelineMatrix(1 + muHome, muAway, { rho: L.rho });
    expect(pScoreline(naive, 0, 0)).toBeGreaterThan(0);
    // O placar atual (1–0) é o mais provável perto do fim; a ingênua não chega perto.
    expect(pScoreline(live, 1, 0)).toBeGreaterThan(pScoreline(naive, 1, 0));
    let total = 0;
    for (const row of live.cells) for (const p of row) total += p;
    expect(total).toBeCloseTo(1, 10);
  });

  it("pré-jogo (sem inPlay) segue a matriz de sempre", () => {
    const pre = readingMatrix(L);
    expect(pre).toEqual(scorelineMatrix(L.lambdaHome, L.lambdaAway, { rho: L.rho }));
    expect(readingMatrix({ ...L, inPlay: null })).toEqual(pre);
  });

  it("matrixFor e computeReadings repassam o inPlay; o contexto mexe no λ antes", () => {
    expect(matrixFor({ rho: L.rho }, L, inPlay)).toEqual(live);
    const base: PalpiteModelBase = {
      origin: "live",
      snapshotId: null,
      modelVersion: null,
      snapshotWeightsVersion: null,
      source: "dixon_coles",
      degraded: false,
      fallbackReason: null,
      staleBase: false,
      lambdaHomeBase: L.lambdaHome,
      lambdaAwayBase: L.lambdaAway,
      rho: L.rho,
      jevAnswers: null,
    };
    const palpite = { kind: "score" as const, home: 2, away: 0 };
    const r = computeReadings(base, {}, palpite, inPlay);
    const expected = readPalpite(
      { matrix: live, lambdaHome: L.lambdaHome, lambdaAway: L.lambdaAway },
      palpite,
    );
    expect(r.without).toEqual(expected);
    expect(r.without.topScorelines.every((c) => c.home >= 1)).toBe(true);
    const preRead = computeReadings(base, {}, palpite);
    expect(preRead.without.palpitePct).not.toBe(r.without.palpitePct);
  });
});

describe("isPastScore", () => {
  const inPlay = inPlayReadingFor(STATE)!;
  it("placar abaixo do atual em algum lado; resultado nunca 'passa'", () => {
    expect(isPastScore({ kind: "score", home: 0, away: 0 }, inPlay)).toBe(true);
    expect(isPastScore({ kind: "score", home: 0, away: 2 }, inPlay)).toBe(true);
    expect(isPastScore({ kind: "score", home: 1, away: 0 }, inPlay)).toBe(false);
    expect(isPastScore({ kind: "result", selection: "away" }, inPlay)).toBe(false);
    expect(isPastScore({ kind: "score", home: 0, away: 0 }, null)).toBe(false);
  });
});
