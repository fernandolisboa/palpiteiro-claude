import { describe, expect, it } from "vitest";

import {
  p1X2,
  pScoreline,
  scorelineMatrix,
  topScorelines,
} from "@/lib/quant/scoreline-model";
import {
  codeVerdict,
  palpiteLabel,
  palpiteToLeg,
  readPalpite,
  readingSentence,
  resultOf,
} from "@/lib/user-palpite/reading";
import type {
  CheckedClaim,
  PalpiteReading,
  UserPalpite,
} from "@/lib/user-palpite/types";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const M = scorelineMatrix(1.6, 1.0);
const read = (p: UserPalpite, matrix = M) =>
  readPalpite({ matrix, lambdaHome: 1.6, lambdaAway: 1.0 }, p);

const round2 = (x: number) => Math.round(x * 10000) / 100;

describe("readPalpite", () => {
  it("placar: chance = pScoreline (pp, 2 casas) e chance do resultado = lado do 1X2", () => {
    const r = read({ kind: "score", home: 2, away: 0 });
    expect(r.palpitePct).toBe(round2(pScoreline(M, 2, 0)));
    expect(r.resultPct).toBe(round2(p1X2(M).home));
  });

  it("1X2 soma ~100", () => {
    const { home, draw, away } = read({ kind: "result", selection: "draw" }).oneXTwo;
    expect(home + draw + away).toBeCloseTo(100, 1);
  });

  it("o placar mais provável tem rank 1", () => {
    const [top] = topScorelines(M, 1);
    expect(read({ kind: "score", home: top.home, away: top.away }).scoreRank).toBe(1);
  });

  it("9×9 tem rank alto e nada vira NaN", () => {
    const r = read({ kind: "score", home: 9, away: 9 });
    expect(r.scoreRank).toBeGreaterThan(50);
    expect(Number.isNaN(r.palpitePct)).toBe(false);
  });

  it("resultado: sem rank; topWithinResult só tem placares do resultado (3)", () => {
    const r = read({ kind: "result", selection: "away" });
    expect(r.scoreRank).toBeNull();
    expect(r.topWithinResult).toHaveLength(3);
    for (const c of r.topWithinResult) expect(c.away).toBeGreaterThan(c.home);
    expect(r.topScorelines).toHaveLength(5);
  });

  it("matriz arredondada a 6 casas dá o mesmo rank da crua", () => {
    const rounded = {
      ...M,
      cells: M.cells.map((row) => row.map((c) => Math.round(c * 1e6) / 1e6)),
    };
    for (const p of [
      { kind: "score", home: 2, away: 0 },
      { kind: "score", home: 1, away: 1 },
      { kind: "score", home: 3, away: 2 },
    ] as const) {
      expect(read(p, rounded).scoreRank).toBe(read(p).scoreRank);
    }
  });
});

describe("rótulos e perna", () => {
  it("palpiteLabel", () => {
    expect(palpiteLabel({ kind: "score", home: 2, away: 0 }, TEAMS)).toBe(
      "Flamengo 2 × 0 Palmeiras",
    );
    expect(palpiteLabel({ kind: "result", selection: "home" }, TEAMS)).toBe(
      "Vitória do Flamengo",
    );
    expect(palpiteLabel({ kind: "result", selection: "draw" }, TEAMS)).toBe("Empate");
  });

  it("palpiteToLeg e resultOf", () => {
    expect(palpiteToLeg({ kind: "score", home: 2, away: 1 })).toEqual({
      kind: "exact_score",
      params: { home: 2, away: 1 },
    });
    expect(palpiteToLeg({ kind: "result", selection: "away" })).toEqual({
      kind: "match_result",
      params: { selection: "away" },
    });
    expect(resultOf({ kind: "score", home: 1, away: 1 })).toBe("draw");
  });

  it("readingSentence usa vírgula decimal e o rank", () => {
    const p = { kind: "score", home: 2, away: 0 } as const;
    const s = readingSentence(read(p), p, TEAMS);
    expect(s).toMatch(/placar mais provável/);
    expect(s).toMatch(/\d+,\d%/);
  });
});

function reading(over: Partial<PalpiteReading>): PalpiteReading {
  return {
    palpitePct: 10,
    resultPct: 40,
    scoreRank: 4,
    oneXTwo: { home: 40, draw: 30, away: 30 },
    topScorelines: [],
    topWithinResult: [],
    lambdaHome: 1,
    lambdaAway: 1,
    ...over,
  };
}

const CONTRADICTED = { status: "contradicted" } as CheckedClaim;

describe("codeVerdict", () => {
  const home = { kind: "result", selection: "home" } as const;
  const away = { kind: "result", selection: "away" } as const;

  it("resultado: favorito ou ≥45% concorda; <25% discorda; senão em parte", () => {
    expect(codeVerdict(reading({ palpitePct: 40 }), home, [])).toBe("concordo");
    expect(
      codeVerdict(
        reading({ palpitePct: 46, oneXTwo: { home: 46, draw: 10, away: 47 } }),
        home,
        [],
      ),
    ).toBe("concordo");
    expect(
      codeVerdict(
        reading({ palpitePct: 24.9, oneXTwo: { home: 50, draw: 25.1, away: 24.9 } }),
        away,
        [],
      ),
    ).toBe("discordo");
    expect(
      codeVerdict(
        reading({ palpitePct: 30, oneXTwo: { home: 40, draw: 30, away: 30 } }),
        away,
        [],
      ),
    ).toBe("em_parte");
  });

  it("placar: favorito e top 3 concorda; resultado <25% discorda; senão em parte", () => {
    const s = { kind: "score", home: 1, away: 0 } as const;
    expect(codeVerdict(reading({ scoreRank: 3 }), s, [])).toBe("concordo");
    expect(codeVerdict(reading({ scoreRank: 4 }), s, [])).toBe("em_parte");
    const a = { kind: "score", home: 0, away: 2 } as const;
    expect(
      codeVerdict(
        reading({ resultPct: 20, scoreRank: 9, oneXTwo: { home: 55, draw: 25, away: 20 } }),
        a,
        [],
      ),
    ).toBe("discordo");
  });

  it("afirmação contradita rebaixa concordo pra em parte (e só ele)", () => {
    expect(codeVerdict(reading({ palpitePct: 50 }), home, [CONTRADICTED])).toBe("em_parte");
    expect(
      codeVerdict(
        reading({ palpitePct: 10, oneXTwo: { home: 80, draw: 10, away: 10 } }),
        away,
        [CONTRADICTED],
      ),
    ).toBe("discordo");
  });
});
