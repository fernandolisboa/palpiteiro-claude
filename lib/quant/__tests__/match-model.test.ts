import { describe, expect, it } from "vitest";

import {
  DC_MAX_FIT_AGE_MS,
  DC_MIN_TEAM_MATCHES,
  pickModelScoreline,
  type PickModelScorelineInput,
} from "@/lib/quant/match-model";
import {
  LAMBDA_MAX,
  LAMBDA_MIN,
  scorelineMatrix,
} from "@/lib/quant/scoreline-model";

const NOW = new Date("2026-09-26T12:00:00Z");
const FIT = {
  homeAdvantage: 1.3,
  rho: -0.06,
  fittedAt: new Date("2026-09-26T07:00:00Z"),
};
const HOME = { attack: 1.25, defence: 0.85, matches: 70 };
const AWAY = { attack: 0.9, defence: 1.15, matches: 70 };
const HEURISTIC = { lambdaHome: 1.5, lambdaAway: 1.1, degradedData: false };

const input = (
  over: Partial<PickModelScorelineInput> = {}
): PickModelScorelineInput => ({
  now: NOW,
  neutral: false,
  dc: { fit: FIT, home: HOME, away: AWAY },
  heuristic: HEURISTIC,
  ...over,
});

describe("pickModelScoreline", () => {
  it("DC utilizável → λ = γ·α_casa·β_fora e α_fora·β_casa, matriz com o ρ do fit", () => {
    const m = pickModelScoreline(input())!;
    const lh = 1.3 * 1.25 * 1.15;
    const la = 0.9 * 0.85;
    expect(m.source).toBe("dixon_coles");
    expect(m.degraded).toBe(false);
    expect(m.fallbackReason).toBeUndefined();
    expect(m.lambdaHome).toBeCloseTo(lh, 12);
    expect(m.lambdaAway).toBeCloseTo(la, 12);
    expect(m.rho).toBe(-0.06);
    expect(m.matrix).toEqual(scorelineMatrix(lh, la, { rho: -0.06 }));
  });

  it("mando neutro → √γ dos dois lados (total não cai pro nível de dois visitantes)", () => {
    const m = pickModelScoreline(input({ neutral: true }))!;
    const g = Math.sqrt(1.3);
    expect(m.lambdaHome).toBeCloseTo(g * 1.25 * 1.15, 12);
    expect(m.lambdaAway).toBeCloseTo(g * 0.9 * 0.85, 12);
  });

  it.each([
    ["γ NaN", { ...FIT, homeAdvantage: NaN }, HOME],
    ["ρ infinito", { ...FIT, rho: Infinity }, HOME],
    ["α NaN", FIT, { ...HOME, attack: NaN }],
    ["β zero", FIT, { ...HOME, defence: 0 }],
  ])(
    "rating corrompido (%s) → heurístico com motivo error",
    (_n, fit, home) => {
      const m = pickModelScoreline(input({ dc: { fit, home, away: AWAY } }))!;
      expect(m.source).toBe("heuristic");
      expect(m.fallbackReason).toBe("error");
    }
  );

  it("λ absurdo é clampado aos limites do modelo de placar", () => {
    const m = pickModelScoreline(
      input({
        dc: {
          fit: FIT,
          home: { attack: 9, defence: 0.01, matches: 70 },
          away: { attack: 0.01, defence: 9, matches: 70 },
        },
      })
    )!;
    expect(m.lambdaHome).toBe(LAMBDA_MAX);
    expect(m.lambdaAway).toBe(LAMBDA_MIN);
  });

  it.each([
    ["flag desligado", { dc: null }, "flag_off"],
    ["erro lendo ratings", { dc: { error: true as const } }, "error"],
    ["liga sem fit", { dc: { fit: null, home: HOME, away: AWAY } }, "no_fit"],
    [
      "fit velho",
      {
        dc: {
          fit: {
            ...FIT,
            fittedAt: new Date(NOW.getTime() - DC_MAX_FIT_AGE_MS - 1),
          },
          home: HOME,
          away: AWAY,
        },
      },
      "stale_fit",
    ],
    [
      "time sem rating",
      { dc: { fit: FIT, home: HOME, away: null } },
      "team_missing",
    ],
    [
      "time com poucos jogos",
      {
        dc: {
          fit: FIT,
          home: { ...HOME, matches: DC_MIN_TEAM_MATCHES - 1 },
          away: AWAY,
        },
      },
      "few_matches",
    ],
  ] as const)("%s → heurístico com motivo %s", (_name, over, reason) => {
    const m = pickModelScoreline(input(over))!;
    expect(m.source).toBe("heuristic");
    expect(m.fallbackReason).toBe(reason);
    expect(m.lambdaHome).toBe(1.5);
    expect(m.lambdaAway).toBe(1.1);
    expect(m.rho).toBeUndefined();
    expect(m.matrix).toEqual(scorelineMatrix(1.5, 1.1));
  });

  it("fit no limite de idade ainda vale", () => {
    const m = pickModelScoreline(
      input({
        dc: {
          fit: {
            ...FIT,
            fittedAt: new Date(NOW.getTime() - DC_MAX_FIT_AGE_MS),
          },
          home: HOME,
          away: AWAY,
        },
      })
    )!;
    expect(m.source).toBe("dixon_coles");
  });

  it("heurístico degradado propaga degraded=true", () => {
    const m = pickModelScoreline(
      input({ dc: null, heuristic: { ...HEURISTIC, degradedData: true } })
    )!;
    expect(m.degraded).toBe(true);
  });

  it("sem DC utilizável e sem tabela → null", () => {
    expect(pickModelScoreline(input({ dc: null, heuristic: null }))).toBeNull();
  });

  it("DC utilizável não precisa da tabela", () => {
    expect(pickModelScoreline(input({ heuristic: null }))?.source).toBe(
      "dixon_coles"
    );
  });
});
