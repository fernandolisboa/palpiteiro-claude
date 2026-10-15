import { describe, expect, it } from "vitest";

import {
  conditionedScorelineMatrix,
  decidedOutcome,
  FIRST_HALF_LENGTH,
  inPlayMinuteLabel,
  inPlayScoreline,
  isDecided,
  isInPlayScoreline,
  KAPPA_SECOND_HALF,
  LIVE_MODEL_VERSION,
  minuteInPeriod,
  MIN_REMAINING_MINUTES,
  RED_OPP,
  RED_OWN,
  redCardMultipliers,
  remainingFraction,
  SECOND_HALF_LENGTH,
  type InPlayClock,
  type InPlayInput,
} from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import {
  DIXON_COLES_RHO,
  KAPPA_FIRST_HALF,
  MAX_GOALS,
  p1X2,
  pOverUnder,
  poissonPmf,
  pScoreline,
  scorelineMatrix,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

const LH = 1.4;
const LA = 1.1;
const RHO = -0.1;

function pre(
  lambdaHome = LH,
  lambdaAway = LA,
  rho: number | undefined = RHO,
): ModelScoreline {
  return {
    source: "dixon_coles",
    degraded: false,
    lambdaHome,
    lambdaAway,
    ...(rho === undefined ? {} : { rho }),
    matrix: scorelineMatrix(lambdaHome, lambdaAway, rho === undefined ? undefined : { rho }),
    baseCheckedAt: new Date("2026-10-15T16:00:00Z"),
  };
}

function state(
  clock: InPlayClock,
  score = { home: 0, away: 0 },
  red: InPlayInput["red"] = { home: 0, away: 0 },
): InPlayInput {
  return { ...clock, score, red };
}

const clock = (
  statusShort: string,
  elapsed: number | null = null,
  extra: number | null = null,
): InPlayClock => ({ statusShort, elapsed, extra });

function sum(m: ScorelineMatrix): number {
  let s = 0;
  for (const row of m.cells) for (const c of row) s += c;
  return s;
}

function maxAbsDiff(a: ScorelineMatrix, b: ScorelineMatrix, upTo: number): number {
  let d = 0;
  for (let h = 0; h <= upTo; h++) {
    for (let a2 = 0; a2 <= upTo; a2++) {
      d = Math.max(d, Math.abs(pScoreline(a, h, a2) - pScoreline(b, h, a2)));
    }
  }
  return d;
}

function rOf(c: InPlayClock): number {
  const f = remainingFraction(c);
  if (!f.ok) throw new Error(`sem leitura: ${f.reason}`);
  return f.r;
}

// ─── r: fração do jogo que falta ─────────────────────────────────────────────

describe("minuteInPeriod", () => {
  it("45+2 no 1º tempo = 47; elapsed 47 sem extra = 47", () => {
    expect(minuteInPeriod(45, 2, 1)).toBe(47);
    expect(minuteInPeriod(47, null, 1)).toBe(47);
  });

  it("reinício do 2º tempo (elapsed 45) = 0; 90+5 = 50", () => {
    expect(minuteInPeriod(45, null, 2)).toBe(0);
    expect(minuteInPeriod(90, 5, 2)).toBe(50);
    expect(minuteInPeriod(63, null, 2)).toBe(18);
  });
});

describe("remainingFraction", () => {
  it("atraso (NS/TBD depois do apito) e minuto 0 do 1º tempo = 1", () => {
    expect(rOf(clock("NS"))).toBe(1);
    expect(rOf(clock("TBD"))).toBe(1);
    expect(rOf(clock("1H", 0))).toBeCloseTo(1, 14);
  });

  it("1H = κ₁·max(L1 − m, ε)/L1 + κ₂; HT = κ₂; 2H = κ₂·max(L2 − m, ε)/L2", () => {
    expect(rOf(clock("1H", 30))).toBeCloseTo(
      (KAPPA_FIRST_HALF * (FIRST_HALF_LENGTH - 30)) / FIRST_HALF_LENGTH + KAPPA_SECOND_HALF,
      14,
    );
    expect(rOf(clock("HT"))).toBe(KAPPA_SECOND_HALF);
    expect(rOf(clock("2H", 70))).toBeCloseTo(
      (KAPPA_SECOND_HALF * (SECOND_HALF_LENGTH - 25)) / SECOND_HALF_LENGTH,
      14,
    );
  });

  it("45+2 e elapsed 47 sem extra dão o mesmo r", () => {
    expect(rOf(clock("1H", 45, 2))).toBe(rOf(clock("1H", 47)));
  });

  it("acréscimo acima do esperado bate no piso ε (r nunca zera em jogo)", () => {
    const floor2 = (KAPPA_SECOND_HALF * MIN_REMAINING_MINUTES) / SECOND_HALF_LENGTH;
    expect(rOf(clock("2H", 90, 5))).toBeCloseTo(
      (KAPPA_SECOND_HALF * (SECOND_HALF_LENGTH - 50)) / SECOND_HALF_LENGTH,
      14,
    );
    expect(rOf(clock("2H", 90, 12))).toBeCloseTo(floor2, 14);
    expect(rOf(clock("1H", 45, 9))).toBeCloseTo(
      (KAPPA_FIRST_HALF * MIN_REMAINING_MINUTES) / FIRST_HALF_LENGTH + KAPPA_SECOND_HALF,
      14,
    );
  });

  it("não cresce com o tempo ao longo do jogo", () => {
    const seq: InPlayClock[] = [
      clock("NS"),
      clock("1H", 0),
      clock("1H", 15),
      clock("1H", 44),
      clock("1H", 45, 2),
      clock("1H", 45, 6),
      clock("HT"),
      clock("2H", 45),
      clock("2H", 60),
      clock("2H", 89),
      clock("2H", 90, 3),
      clock("2H", 90, 10),
    ];
    const rs = seq.map(rOf);
    for (let i = 1; i < rs.length; i++) expect(rs[i]).toBeLessThanOrEqual(rs[i - 1]!);
  });

  it("sem leitura: ET/BT/P, terminais, minuto desconhecido, interrompido, desconhecido", () => {
    for (const s of ["ET", "BT", "P"]) {
      expect(remainingFraction(clock(s, 95))).toEqual({ ok: false, reason: "extra_time" });
    }
    for (const s of ["FT", "AET", "PEN", "AWD", "WO", "PST", "CANC", "ABD"]) {
      expect(remainingFraction(clock(s, 90))).toEqual({ ok: false, reason: "terminal" });
    }
    expect(remainingFraction(clock("1H", null))).toEqual({ ok: false, reason: "minute_unknown" });
    expect(remainingFraction(clock("2H", null))).toEqual({ ok: false, reason: "minute_unknown" });
    expect(remainingFraction(clock("LIVE", 30))).toEqual({ ok: false, reason: "minute_unknown" });
    expect(remainingFraction(clock("INT", 30))).toEqual({ ok: false, reason: "interrupted" });
    expect(remainingFraction(clock("SUSP", 30))).toEqual({ ok: false, reason: "interrupted" });
    expect(remainingFraction(clock("XYZ", 30))).toEqual({ ok: false, reason: "unknown_status" });
  });
});

describe("inPlayMinuteLabel", () => {
  it("63', 45+2', intervalo, 0'", () => {
    expect(inPlayMinuteLabel(clock("2H", 63))).toBe("63'");
    expect(inPlayMinuteLabel(clock("1H", 45, 2))).toBe("45+2'");
    expect(inPlayMinuteLabel(clock("HT", 45))).toBe("intervalo");
    expect(inPlayMinuteLabel(clock("NS"))).toBe("0'");
  });
});

// ─── Matriz condicionada ─────────────────────────────────────────────────────

describe("inPlayScoreline: limites", () => {
  it("minuto 0 (atraso NS), 0-0, sem expulsão → idêntica célula a célula à pré-jogo", () => {
    const p = pre();
    const f = inPlayScoreline(p, state(clock("NS")))!;
    expect(f.matrix.maxGoals).toBe(p.matrix.maxGoals);
    expect(f.matrix.cells).toEqual(p.matrix.cells);
  });

  it("minuto 0 do 1º tempo → pré-jogo com tolerância 1e-12 (inclusive ρ ausente = pinado)", () => {
    for (const p of [pre(), pre(1.7, 0.9, undefined), pre(0.6, 2.4, -0.04)]) {
      const f = inPlayScoreline(p, state(clock("1H", 0)))!;
      expect(maxAbsDiff(f.matrix, p.matrix, MAX_GOALS)).toBeLessThan(1e-12);
    }
  });

  it("sem dados de expulsão no minuto 0 também bate o pré-jogo", () => {
    const p = pre();
    const f = inPlayScoreline(p, state(clock("NS"), { home: 0, away: 0 }, null))!;
    expect(f.matrix.cells).toEqual(p.matrix.cells);
    expect(f.inPlay.red).toBeNull();
    expect(f.inPlay.multipliers).toEqual({ home: 1, away: 1 });
  });

  it("r → 0 vira massa pontual no placar atual (o τ se cancela)", () => {
    for (const score of [
      { home: 0, away: 0 },
      { home: 1, away: 0 },
      { home: 2, away: 3 },
    ]) {
      const { matrix } = conditionedScorelineMatrix({
        lambdaHome: LH,
        lambdaAway: LA,
        rho: RHO,
        muHome: 0,
        muAway: 0,
        score,
      });
      expect(pScoreline(matrix, score.home, score.away)).toBe(1);
      expect(sum(matrix)).toBe(1);
    }
  });

  it("fim do 2º tempo com acréscimo estourado ≈ massa pontual", () => {
    const f = inPlayScoreline(pre(), state(clock("2H", 90, 12), { home: 2, away: 1 }))!;
    // Piso ε: r = κ₂·0,5/51 ≈ 0,0054 → μ total ≈ 0,013 → ~98,7% de nenhum gol a mais.
    expect(pScoreline(f.matrix, 2, 1)).toBeGreaterThan(0.98);
    expect(pScoreline(f.matrix, 2, 1)).toBeCloseTo(Math.exp(-(f.inPlay.muHome + f.inPlay.muAway)), 2);
  });

  it("placar abaixo do atual tem probabilidade 0 e Σ = 1", () => {
    const f = inPlayScoreline(pre(), state(clock("2H", 60), { home: 1, away: 2 }))!;
    for (let h = 0; h <= f.matrix.maxGoals; h++) {
      for (let a = 0; a <= f.matrix.maxGoals; a++) {
        if (h < 1 || a < 2) expect(f.matrix.cells[h]![a]).toBe(0);
      }
    }
    expect(sum(f.matrix)).toBeCloseTo(1, 12);
  });

  it("com algum lado em 2+ o τ é inerte: produto de Poisson puro deslocado", () => {
    const score = { home: 2, away: 0 };
    const f = inPlayScoreline(pre(), state(clock("2H", 60), score))!;
    const { muHome, muAway } = f.inPlay;
    let z = 0;
    const raw: number[][] = [];
    for (let h = 0; h <= f.matrix.maxGoals; h++) {
      raw.push([]);
      for (let a = 0; a <= f.matrix.maxGoals; a++) {
        const ok = h >= 2 && h - 2 <= MAX_GOALS && a - 0 <= MAX_GOALS;
        const v = ok ? poissonPmf(h - 2, muHome) * poissonPmf(a, muAway) : 0;
        raw[h]!.push(v);
        z += v;
      }
    }
    for (let h = 0; h <= f.matrix.maxGoals; h++) {
      for (let a = 0; a <= f.matrix.maxGoals; a++) {
        expect(f.matrix.cells[h]![a]).toBeCloseTo(raw[h]![a]! / z, 14);
      }
    }
  });

  it("placar grande (7×6) não trunca: grade cresce com o placar", () => {
    const f = inPlayScoreline(pre(), state(clock("2H", 80), { home: 7, away: 6 }))!;
    expect(f.matrix.maxGoals).toBe(7 + MAX_GOALS);
    expect(sum(f.matrix)).toBeCloseTo(1, 12);
    expect(pScoreline(f.matrix, 7, 6)).toBeGreaterThan(0.5);
  });

  it("λ minúsculo aos 89' segue finito e normalizado", () => {
    const f = inPlayScoreline(pre(0.2, 0.2), state(clock("2H", 89), { home: 0, away: 0 }))!;
    expect(sum(f.matrix)).toBeCloseTo(1, 12);
    expect(pScoreline(f.matrix, 0, 0)).toBeGreaterThan(0.95);
    for (const row of f.matrix.cells) for (const c of row) expect(Number.isFinite(c)).toBe(true);
  });

  it("sem leitura → null (prorrogação, encerrado, sem minuto, placar inválido)", () => {
    expect(inPlayScoreline(pre(), state(clock("ET", 100)))).toBeNull();
    expect(inPlayScoreline(pre(), state(clock("FT", 90)))).toBeNull();
    expect(inPlayScoreline(pre(), state(clock("2H", null)))).toBeNull();
    expect(inPlayScoreline(pre(), state(clock("2H", 60), { home: -1, away: 0 }))).toBeNull();
    expect(inPlayScoreline(pre(), state(clock("2H", 60), { home: 0.5, away: 0 }))).toBeNull();
    expect(inPlayScoreline(pre(Number.NaN, 1), state(clock("2H", 60)))).toBeNull();
  });
});

describe("inPlayScoreline: R2 (λ 1,4 × 1,1, ρ −0,1, r = 0,35, 0-0)", () => {
  it("P(termina 0-0) = 46,8% (coerente), contra 42,0% do rascunho e 41,7% do Poisson puro", () => {
    const r = 0.35;
    const { matrix } = conditionedScorelineMatrix({
      lambdaHome: LH,
      lambdaAway: LA,
      rho: RHO,
      muHome: LH * r,
      muAway: LA * r,
      score: { home: 0, away: 0 },
    });
    const coherent = pScoreline(matrix, 0, 0);
    expect(coherent).toBeCloseTo(0.468355504730823, 12);
    expect(coherent * 100).toBeCloseTo(46.8, 1);

    const draft = pScoreline(scorelineMatrix(LH * r, LA * r, { rho: RHO * r }), 0, 0);
    expect(draft * 100).toBeCloseTo(42.0, 1);
    const poisson = Math.exp(-(LH + LA) * r);
    expect(poisson * 100).toBeCloseTo(41.7, 1);
  });

  it("o mesmo número sai de inPlayScoreline num relógio com r ≈ 0,35 (~63')", () => {
    const f = inPlayScoreline(pre(), state(clock("2H", 63)))!;
    expect(f.inPlay.r).toBeCloseTo(0.35, 1);
    expect(pScoreline(f.matrix, 0, 0)).toBeGreaterThan(0.45);
    expect(pScoreline(f.matrix, 0, 0)).toBeLessThan(0.49);
  });
});

describe("inPlayScoreline: coerência com o pré-jogo (lei da probabilidade total)", () => {
  // Σ_{h0,a0} w(h0,a0) · F_{h0,a0} = pre.matrix, com w ∝ Pois(h0; λH(1−r)) ·
  // Pois(a0; λA(1−r)) · Z(h0,a0) e Z o normalizador de F. Tolerância pela truncagem.
  const cases: Array<[string, InPlayClock]> = [
    ["15'", clock("1H", 15)],
    ["intervalo", clock("HT")],
    ["70'", clock("2H", 70)],
  ];

  for (const [label, c] of cases) {
    it(`mistura sobre o placar aos ${label} devolve a matriz pré-jogo (1e-6)`, () => {
      const r = rOf(c);
      const preMatrix = scorelineMatrix(LH, LA, { rho: RHO });
      const mix = Array.from({ length: MAX_GOALS + 1 }, () =>
        new Array<number>(MAX_GOALS + 1).fill(0),
      );
      let total = 0;
      for (let h0 = 0; h0 <= MAX_GOALS; h0++) {
        for (let a0 = 0; a0 <= MAX_GOALS; a0++) {
          const { matrix, mass } = conditionedScorelineMatrix({
            lambdaHome: LH,
            lambdaAway: LA,
            rho: RHO,
            muHome: LH * r,
            muAway: LA * r,
            score: { home: h0, away: a0 },
          });
          const w = poissonPmf(h0, LH * (1 - r)) * poissonPmf(a0, LA * (1 - r)) * mass;
          total += w;
          for (let h = 0; h <= MAX_GOALS; h++) {
            for (let a = 0; a <= MAX_GOALS; a++) {
              mix[h]![a]! += w * pScoreline(matrix, h, a);
            }
          }
        }
      }
      let err = 0;
      for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {
          err = Math.max(err, Math.abs(mix[h]![a]! / total - preMatrix.cells[h]![a]!));
        }
      }
      expect(err).toBeLessThan(1e-6);
    });
  }
});

// ─── Expulsões ───────────────────────────────────────────────────────────────

describe("redCardMultipliers", () => {
  it("d = ±1, ±2, 1×1, 3 de um lado clampado, sem dados", () => {
    expect(redCardMultipliers({ home: 1, away: 0 })).toEqual({
      home: RED_OWN,
      away: RED_OPP,
      netRed: 1,
    });
    expect(redCardMultipliers({ home: 0, away: 1 })).toEqual({
      home: RED_OPP,
      away: RED_OWN,
      netRed: -1,
    });
    expect(redCardMultipliers({ home: 2, away: 0 })).toEqual({
      home: RED_OWN ** 2,
      away: RED_OPP ** 2,
      netRed: 2,
    });
    expect(redCardMultipliers({ home: 1, away: 1 })).toEqual({ home: 1, away: 1, netRed: 0 });
    expect(redCardMultipliers({ home: 3, away: 0 })).toEqual(
      redCardMultipliers({ home: 2, away: 0 }),
    );
    expect(redCardMultipliers({ home: 0, away: 4 })).toEqual(
      redCardMultipliers({ home: 0, away: 2 }),
    );
    expect(redCardMultipliers(null)).toEqual({ home: 1, away: 1, netRed: null });
  });
});

describe("inPlayScoreline: expulsões", () => {
  const at = clock("2H", 55);

  it("monotonia: vermelho do mandante baixa a vitória dele e sobe a do visitante", () => {
    const none = p1X2(inPlayScoreline(pre(), state(at))!.matrix);
    const one = p1X2(inPlayScoreline(pre(), state(at, undefined, { home: 1, away: 0 }))!.matrix);
    const two = p1X2(inPlayScoreline(pre(), state(at, undefined, { home: 2, away: 0 }))!.matrix);
    expect(one.home).toBeLessThan(none.home);
    expect(two.home).toBeLessThan(one.home);
    expect(one.away).toBeGreaterThan(none.away);
    expect(two.away).toBeGreaterThan(one.away);

    const awayRed = p1X2(
      inPlayScoreline(pre(), state(at, undefined, { home: 0, away: 1 }))!.matrix,
    );
    expect(awayRed.home).toBeGreaterThan(none.home);
    expect(awayRed.away).toBeLessThan(none.away);
  });

  it("o multiplicador vale sobre o λ RESTANTE (μ), nunca sobre o placar já feito", () => {
    const f = inPlayScoreline(pre(), state(at, { home: 1, away: 0 }, { home: 1, away: 0 }))!;
    const r = f.inPlay.r;
    expect(f.inPlay.muHome).toBeCloseTo(LH * r * RED_OWN, 14);
    expect(f.inPlay.muAway).toBeCloseTo(LA * r * RED_OPP, 14);
    expect(f.lambdaHome).toBeCloseTo(1 + f.inPlay.muHome, 14);
    expect(f.lambdaAway).toBeCloseTo(f.inPlay.muAway, 14);
  });

  it("1×1 = sem expulsão", () => {
    const none = inPlayScoreline(pre(), state(at))!;
    const both = inPlayScoreline(pre(), state(at, undefined, { home: 1, away: 1 }))!;
    expect(both.matrix.cells).toEqual(none.matrix.cells);
  });

  it("d = +1 e d = −1 simétricos ao trocar mandante e visitante", () => {
    const score = { home: 1, away: 0 };
    const a = inPlayScoreline(pre(LH, LA), state(at, score, { home: 1, away: 0 }))!;
    const b = inPlayScoreline(
      pre(LA, LH),
      state(at, { home: score.away, away: score.home }, { home: 0, away: 1 }),
    )!;
    for (let h = 0; h <= a.matrix.maxGoals; h++) {
      for (let g = 0; g <= a.matrix.maxGoals; g++) {
        expect(a.matrix.cells[h]![g]).toBeCloseTo(b.matrix.cells[g]![h]!, 14);
      }
    }
  });
});

describe("inPlayScoreline: saída", () => {
  it("carrega o carimbo do modelo em jogo e a fonte do pré-jogo", () => {
    const p = pre();
    const f = inPlayScoreline(p, state(clock("2H", 63), { home: 1, away: 0 }))!;
    expect(isInPlayScoreline(f)).toBe(true);
    expect(isInPlayScoreline(p)).toBe(false);
    expect(f.source).toBe("dixon_coles");
    expect(f.rho).toBe(RHO);
    expect(f.baseCheckedAt).toEqual(p.baseCheckedAt);
    expect(f.inPlay).toMatchObject({
      liveModelVersion: LIVE_MODEL_VERSION,
      minuteLabel: "63'",
      score: { home: 1, away: 0 },
      red: { home: 0, away: 0 },
      preMatch: {
        source: "dixon_coles",
        lambdaHome: LH,
        lambdaAway: LA,
        rho: RHO,
        baseCheckedAt: p.baseCheckedAt,
      },
    });
    expect(LIVE_MODEL_VERSION).toBe("live_model_v1");
  });

  it("ρ ausente no pré-jogo = o pinado de scorelineMatrix", () => {
    const f = inPlayScoreline(pre(1.4, 1.1, undefined), state(clock("HT")))!;
    expect(f.rho).toBe(DIXON_COLES_RHO);
    expect(f.inPlay.preMatch.rho).toBe(DIXON_COLES_RHO);
  });

  it("os leitores da matriz já enxergam o placar: over 1.5 com 2-0 é certo", () => {
    const f = inPlayScoreline(pre(), state(clock("2H", 60), { home: 2, away: 0 }))!;
    expect(pOverUnder(f.matrix, 1.5)).toBeCloseTo(1, 12);
  });
});

// ─── Seleção decidida ────────────────────────────────────────────────────────

describe("isDecided / decidedOutcome", () => {
  const s = (home: number, away: number) => ({ home, away });

  it("over/under: total acima da linha → over ganhou, under perdeu; senão em aberto", () => {
    expect(decidedOutcome("over_under", { line: 1.5, selection: "over" }, s(2, 0))).toBe("won");
    expect(decidedOutcome("over_under", { line: 1.5, selection: "under" }, s(2, 0))).toBe("lost");
    expect(decidedOutcome("over_under", { line: 2.5, selection: "over" }, s(2, 0))).toBeNull();
    expect(decidedOutcome("over_under", { line: 2.5, selection: "under" }, s(1, 1))).toBeNull();
  });

  it("BTTS: os dois marcaram → sim ganhou, não perdeu", () => {
    expect(decidedOutcome("btts", { selection: "yes" }, s(1, 1))).toBe("won");
    expect(decidedOutcome("btts", { selection: "no" }, s(1, 1))).toBe("lost");
    expect(decidedOutcome("btts", { selection: "yes" }, s(3, 0))).toBeNull();
  });

  it("placar exato abaixo do atual em algum lado → perdeu", () => {
    expect(decidedOutcome("exact_score", { home: 0, away: 0 }, s(1, 0))).toBe("lost");
    expect(decidedOutcome("exact_score", { home: 2, away: 0 }, s(1, 1))).toBe("lost");
    expect(decidedOutcome("exact_score", { home: 1, away: 0 }, s(1, 0))).toBeNull();
    expect(decidedOutcome("exact_score", { home: 2, away: 1 }, s(1, 0))).toBeNull();
  });

  it("clean sheet do lado que já sofreu → perdeu", () => {
    expect(decidedOutcome("clean_sheet", { side: "home" }, s(2, 1))).toBe("lost");
    expect(decidedOutcome("clean_sheet", { side: "away" }, s(2, 1))).toBe("lost");
    expect(decidedOutcome("clean_sheet", { side: "home" }, s(2, 0))).toBeNull();
    expect(decidedOutcome("clean_sheet", { side: "away" }, s(0, 3))).toBeNull();
  });

  it("1X2, dupla chance e margem nunca se decidem antes do fim", () => {
    expect(isDecided("match_result", { selection: "home" }, s(5, 0))).toBe(false);
    expect(isDecided("double_chance", { selection: "home_draw" }, s(5, 0))).toBe(false);
    expect(isDecided("margin", { side: "home", minMargin: 2 }, s(5, 0))).toBe(false);
  });

  it("tipos fora do ao vivo (1º tempo, quem marca primeiro) ficam em aberto", () => {
    expect(isDecided("first_half_score", { home: 0, away: 0 }, s(1, 0))).toBe(false);
    expect(isDecided("first_to_score", { firstToScore: "home" }, s(1, 0))).toBe(false);
  });

  it("isDecided = decidedOutcome não nulo", () => {
    expect(isDecided("over_under", { line: 1.5, selection: "over" }, s(2, 0))).toBe(true);
    expect(isDecided("btts", { selection: "yes" }, s(1, 1))).toBe(true);
    expect(isDecided("exact_score", { home: 0, away: 0 }, s(1, 0))).toBe(true);
  });
});
