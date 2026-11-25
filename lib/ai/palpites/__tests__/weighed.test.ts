import { describe, expect, it, vi } from "vitest";

import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { factorMultiplier } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentQuestionId } from "@/lib/ai/judgments/types";
import {
  weighPick,
  weighPickDetailed,
  weighedFactorInputs,
  type OutcomeTriple,
  type PalpiteWeighed,
  type WeighArgs,
  type WeighedInputs,
} from "@/lib/ai/palpites/weighed";
import { p1X2, scorelineMatrix } from "@/lib/quant/scoreline-model";

import { codeJev, type Nouls } from "./weighed-fixtures";

const OUTCOMES = ["home", "draw", "away"] as const;

// Os argumentos do weighPick a partir de um julgamento, como o pick faria na base dc_jev.
function argsOf(
  j: PredictionJudgments,
  over: Partial<WeighArgs> = {}
): WeighArgs {
  const rho = j.lambda.rho ?? -0.1;
  const finalRaw = p1X2(
    scorelineMatrix(j.lambda.adjusted.home, j.lambda.adjusted.away, { rho })
  );
  return {
    base: j.lambda.base,
    rho,
    inputs: weighedFactorInputs(j),
    multipliers: {
      home: j.lambda.adjusted.home / j.lambda.base.home,
      away: j.lambda.adjusted.away / j.lambda.base.away,
    },
    finalRaw,
    ...over,
  };
}

function weigh(j: PredictionJudgments): PalpiteWeighed {
  const r = weighPickDetailed(argsOf(j));
  if (!r.ok) throw new Error(r.reason);
  return r.weighed;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const sumTriple = (t: OutcomeTriple) => t.home + t.draw + t.away;

describe("weighedFactorInputs — origem de cada fator (R7)", () => {
  it("JEV puro", () => {
    const inputs = weighedFactorInputs(
      codeJev({ jev: { attack_weakened_home: 0.9 } })
    )!;
    expect(inputs.factors).toEqual([
      {
        key: "attack_weakened_home",
        lambdaSide: "home",
        multiplier: factorMultiplier("attack_weakened", 0.9),
        origin: "jev",
        value: 0.9,
      },
    ]);
  });

  it("notícia acima do JEV → news; usuário acima dos dois → user", () => {
    const j = codeJev({
      jev: { attack_weakened_home: 0.6, defense_weakened_away: 0.6 },
      news: { attack_weakened_home: 0.7, defense_weakened_away: 0.7 },
      user: { defense_weakened_away: 0.85 },
    });
    const by = Object.fromEntries(
      weighedFactorInputs(j)!.factors.map((f) => [f.key, f])
    );
    expect(by.attack_weakened_home).toMatchObject({
      origin: "news",
      value: 0.7,
    });
    expect(by.defense_weakened_away).toMatchObject({
      origin: "user",
      value: 0.85,
    });
  });

  it("empate JEV = usuário fica JEV; usuário 0,7 com JEV 0,8 fica JEV", () => {
    const tie = codeJev({
      jev: { rotation_risk_home: 0.7 },
      user: { rotation_risk_home: 0.7 },
    });
    expect(weighedFactorInputs(tie)!.factors[0]).toMatchObject({
      origin: "jev",
      value: 0.7,
    });
    const below = codeJev({
      jev: { rotation_risk_home: 0.8 },
      user: { rotation_risk_home: 0.7 },
    });
    expect(weighedFactorInputs(below)!.factors[0]).toMatchObject({
      origin: "jev",
      value: 0.8,
    });
  });

  it("usuário só move acima de JEV ∨ notícia (modelAnswersOf)", () => {
    const j = codeJev({
      news: { high_stakes_home: 0.85 },
      user: { high_stakes_home: 0.7 },
    });
    expect(weighedFactorInputs(j)!.factors[0]).toMatchObject({
      origin: "news",
      value: 0.85,
    });
  });

  it("sem news.evidence: nenhum fator sai como notícia", () => {
    const j = codeJev({ jev: { high_stakes_away: 0.9 } });
    expect(j.news).toBeUndefined();
    expect(weighedFactorInputs(j)!.factors.map((f) => f.origin)).toEqual([
      "jev",
    ]);
  });

  it("contexto extra ilegível → null (na dúvida, nenhum fator)", () => {
    const j = {
      ...codeJev({ jev: { attack_weakened_home: 0.9 } }),
      userContext: { evidence: 1 } as never,
    };
    expect(weighedFactorInputs(j)).toBeNull();
  });

  it("não é code_jev → null", () => {
    expect(weighedFactorInputs(null)).toBeNull();
    expect(
      weighedFactorInputs({ engine: "llm" } as unknown as PredictionJudgments)
    ).toBeNull();
  });

  it("JEV falho sem contexto (multipliers null) → nada mexeu (R4)", () => {
    const j = codeJev({ jev: null });
    expect(j.multipliers).toBeNull();
    expect(weighedFactorInputs(j)).toEqual({
      factors: [],
      applied: { home: 1, away: 1 },
      product: { home: 1, away: 1 },
    });
  });

  it("lado vem da posição: defense_weakened_away multiplica o λ do mandante", () => {
    const f = weighedFactorInputs(
      codeJev({ jev: { defense_weakened_away: 0.9 } })
    )!.factors[0];
    expect(f).toMatchObject({
      key: "defense_weakened_away",
      lambdaSide: "home",
    });
    expect(f.multiplier).toBeGreaterThan(1);
  });
});

describe("weighPick — ordem", () => {
  it("jev → news → user e, dentro da origem, a canônica", () => {
    const j = codeJev({
      jev: { high_stakes_away: 0.9, attack_weakened_home: 0.9 },
      news: { defense_weakened_home: 0.7 },
      user: { rotation_risk_away: 0.7, attack_weakened_away: 0.7 },
    });
    expect(weigh(j).factors.map((f) => `${f.origin}:${f.key}`)).toEqual([
      "jev:attack_weakened_home",
      "jev:high_stakes_away",
      "news:defense_weakened_home",
      "user:attack_weakened_away",
      "user:rotation_risk_away",
    ]);
  });

  it("invariante à ordem das chaves do jsonb (R10)", () => {
    const j = codeJev({
      jev: {
        attack_weakened_home: 0.9,
        defense_weakened_away: 0.8,
        high_stakes_home: 0.85,
      },
    });
    const shuffled: PredictionJudgments = JSON.parse(JSON.stringify(j));
    for (const side of ["home", "away"] as const) {
      const f = shuffled.multipliers![side].factors;
      shuffled.multipliers![side].factors = Object.fromEntries(
        Object.entries(f).reverse()
      );
    }
    expect(weigh(shuffled)).toEqual(weigh(j));
  });
});

describe("weighPick — conferências (fail-closed)", () => {
  it("linha simétrica antiga: 'não' que mexeu no λ ao contrário → factor_direction (R3)", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    // Regra simétrica: noul 0,2 em attack_weakened_away AUMENTA o ataque do visitante.
    const m = 1 + 0.06 * (0.5 - 0.2) * 2;
    j.multipliers!.away.factors.attack_weakened_away = m;
    j.multipliers!.away.product = m;
    j.multipliers!.away.applied = m;
    j.lambda.adjusted.away = j.lambda.base.away * m;
    expect(weighPickDetailed(argsOf(j))).toEqual({
      ok: false,
      reason: "factor_direction",
    });
  });

  it("multiplicador do pick sem os fatores da análise → no_factors", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    expect(weighPickDetailed(argsOf(j, { inputs: null }))).toEqual({
      ok: false,
      reason: "no_factors",
    });
  });

  it("multiplicador do pick ≈ 1 sem leitura dos fatores → nenhum ajuste (R4)", () => {
    const j = codeJev({ jev: null });
    const r = weighPickDetailed(
      argsOf(j, { inputs: null, multipliers: { home: 1, away: 1 + 1e-12 } })
    );
    expect(r.ok && r.weighed.factors).toEqual([]);
    expect(r.ok && r.weighed.basePts).toEqual(r.ok && r.weighed.finalPts);
  });

  it("multiplicadores incoerentes com o pick → multiplier_mismatch", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    const r = weighPickDetailed(
      argsOf(j, { multipliers: { home: 0.9, away: 1 } })
    );
    expect(r).toEqual({ ok: false, reason: "multiplier_mismatch" });
  });

  it("P final que não fecha com a sequência → sequence_mismatch", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    const r = weighPickDetailed(
      argsOf(j, { finalRaw: { home: 0.4, draw: 0.3, away: 0.3 } })
    );
    expect(r).toEqual({ ok: false, reason: "sequence_mismatch" });
  });

  it("fator desconhecido no produto (chave a mais no jsonb) → multiplier_mismatch, não clamp", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    // O efeito de um fator que a leitura não conhece não pode ser repassado aos outros.
    const extra = 0.9;
    const h = j.multipliers!.home;
    (h.factors as Record<string, number>).unknown_factor_home = extra;
    h.product *= extra;
    h.applied *= extra;
    j.lambda.adjusted.home = j.lambda.base.home * h.applied;
    expect(weighPickDetailed(argsOf(j))).toEqual({
      ok: false,
      reason: "multiplier_mismatch",
    });
  });

  it("clamp que não encolhe (applied além do produto, ou do lado oposto) → clamp", () => {
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    const m = j.multipliers!.home.product;
    for (const applied of [m * m, 1 / m]) {
      const k: PredictionJudgments = JSON.parse(JSON.stringify(j));
      k.multipliers!.home.applied = applied;
      k.lambda.adjusted.home = k.lambda.base.home * applied;
      expect(weighPickDetailed(argsOf(k))).toEqual({
        ok: false,
        reason: "clamp",
      });
    }
  });

  it("jsonb torto: a leitura dos fatores e o weighPick não lançam (null + aviso)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    const broken = {
      ...j,
      multipliers: { home: null, away: 1 },
    } as unknown as PredictionJudgments;
    expect(weighedFactorInputs(broken)).toBeNull();
    expect(warn).toHaveBeenCalledWith({
      scope: "palpite_weighed",
      reason: "error",
    });
    warn.mockClear();
    const inputs = {
      ...weighedFactorInputs(j)!,
      applied: null,
      product: null,
    } as unknown as WeighedInputs;
    expect(weighPick(argsOf(j, { inputs }))).toBeNull();
    expect(warn).toHaveBeenCalledWith({
      scope: "palpite_weighed",
      reason: "error",
    });
    warn.mockRestore();
  });

  it("weighPick avisa e devolve null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = codeJev({ jev: { attack_weakened_home: 0.9 } });
    expect(weighPick(argsOf(j, { inputs: null }))).toBeNull();
    expect(warn).toHaveBeenCalledWith({
      scope: "palpite_weighed",
      reason: "no_factors",
    });
    warn.mockRestore();
  });
});

describe("weighPick — clamp sintético (corte proporcional em log)", () => {
  it("1,10 × 1,10 com applied 1,15: Π m' = applied, proporção preservada", () => {
    const base = { home: 1.2, away: 1.0 };
    const inputs: WeighedInputs = {
      factors: [
        {
          key: "defense_weakened_away",
          lambdaSide: "home",
          multiplier: 1.1,
          origin: "jev",
          value: 0.9,
        },
        {
          key: "high_stakes_home",
          lambdaSide: "home",
          multiplier: 1.1,
          origin: "jev",
          value: 0.9,
        },
      ],
      applied: { home: 1.15, away: 1 },
      product: { home: 1.21, away: 1 },
    };
    const rho = -0.1;
    const lambda = { home: base.home * 1.15, away: base.away };
    const r = weighPickDetailed({
      base,
      rho,
      inputs,
      multipliers: { home: 1.15, away: 1 },
      finalRaw: p1X2(scorelineMatrix(lambda.home, lambda.away, { rho })),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.weighed.factors;
    expect(a.multiplier * b.multiplier).toBeCloseTo(1.15, 5);
    expect(a.multiplier).toBeCloseTo(b.multiplier, 6);
    expect(a.multiplier).toBeCloseTo(Math.sqrt(1.15), 5);
    expect(r.weighed.clamped).toEqual({ home: true, away: false });
  });
});

describe("weighPick — conta e inteiros", () => {
  const j = codeJev({
    base: { home: 1.35, away: 1.15 },
    jev: {
      attack_weakened_home: 0.9,
      defense_weakened_home: 0.8,
      high_stakes_away: 0.85,
    },
    user: { rotation_risk_home: 0.7 },
  });

  it("telescópica: Σ Δ = P final − P base", () => {
    const w = weigh(j);
    const final = argsOf(j).finalRaw;
    for (const k of OUTCOMES) {
      const total = sum(w.factors.map((f) => f.pp[k]));
      expect(total).toBeCloseTo(final[k] * 100 - w.baseProbs[k], 1);
    }
  });

  it("inteiros: cada fator soma 0; colunas = final − base; base e final somam 100", () => {
    const w = weigh(j);
    expect(sumTriple(w.basePts)).toBe(100);
    expect(sumTriple(w.finalPts)).toBe(100);
    for (const f of w.factors) expect(sumTriple(f.pts)).toBe(0);
    for (const k of OUTCOMES) {
      expect(sum(w.factors.map((f) => f.pts[k]))).toBe(
        w.finalPts[k] - w.basePts[k]
      );
    }
  });

  it("determinístico: dez chamadas iguais", () => {
    const first = weigh(j);
    for (let i = 0; i < 10; i++) expect(weigh(j)).toEqual(first);
  });
});

describe("weighPick — propriedade (λ, ρ e nouls aleatórios)", () => {
  it("somas exatas, sinal certo nos três resultados, |pts − cru| < 2, null ≤ 1%", () => {
    const r = rng(683);
    const pick = (): number => {
      const x = r();
      return x < 0.55 ? 0.2 : 0.5 + x * 0.5;
    };
    let nulls = 0;
    const N = 400;
    for (let n = 0; n < N; n++) {
      const jev: Nouls = {};
      const news: Nouls = {};
      const user: Nouls = {};
      for (const id of JUDGMENT_QUESTION_IDS as readonly JudgmentQuestionId[]) {
        jev[id] = pick();
        if (r() < 0.12) news[id] = r() < 0.5 ? 0.7 : 0.85;
        if (r() < 0.12) user[id] = r() < 0.5 ? 0.7 : 0.85;
      }
      const j = codeJev({
        base: { home: 0.4 + r() * 2.6, away: 0.4 + r() * 2.2 },
        jev,
        news,
        user,
        rho: -0.2 + r() * 0.2,
      });
      const res = weighPickDetailed(argsOf(j));
      if (!res.ok) {
        expect(res.reason).toBe("rounding_conflict");
        nulls++;
        continue;
      }
      const w = res.weighed;
      expect(sumTriple(w.basePts)).toBe(100);
      expect(sumTriple(w.finalPts)).toBe(100);
      for (const f of w.factors) {
        expect(sumTriple(f.pts)).toBe(0);
        for (const k of OUTCOMES) {
          expect(Math.abs(f.pts[k] - f.pp[k])).toBeLessThan(2);
          if (f.pts[k] !== 0)
            expect(Math.sign(f.pts[k])).toBe(Math.sign(f.pp[k]));
        }
      }
      for (const k of OUTCOMES) {
        expect(sum(w.factors.map((f) => f.pts[k]))).toBe(
          w.finalPts[k] - w.basePts[k]
        );
      }
    }
    expect(nulls / N).toBeLessThanOrEqual(0.01);
  });
});
