import { describe, expect, it } from "vitest";

import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import {
  buildFactsBlock,
  complementPct,
  scorelineKey,
} from "@/lib/underdog/facts";
import type { UnderdogFacts } from "@/lib/underdog/types";

import { answers, KICKOFF, NOW, snapshot } from "./fixtures";

const CTX = {
  teams: { home: "Palmeiras", away: "Flamengo" },
  competition: "Brasileirão Série A",
  kickoffLabel: "sáb, 21 nov, 16:30",
};

function facts(): UnderdogFacts {
  const base = underdogBaseFromSnapshot(snapshot(), KICKOFF, NOW)!;
  return computeUnderdogFacts(base, [
    { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
  ]);
}

describe("computeUnderdogFacts", () => {
  it("lado, chances, 3 placares, cenários e o modelo", () => {
    const f = facts();
    expect(f.side).toBe("away");
    expect(f.scorelines).toHaveLength(3);
    expect(f.scenarios.length).toBeGreaterThan(0);
    expect(f.model).toEqual({ source: "dixon_coles", jevApplied: false });
  });

  it("sinais do JEV da base entram depois dos de dado", () => {
    const snap = snapshot({
      jevStatus: "applied",
      judgments: {
        applied: true,
        answers: answers({ rotation_risk_home: 0.9 }),
        multipliers: null,
        versions: {
          judgments: "j",
          weights: "w",
          jevModel: "m",
          jevModelServed: "m",
        },
        failure: null,
        stateHash: "h",
        aiCallId: null,
        reusedFromPredictionId: null,
        reusedFromModelSnapshotId: null,
      },
    });
    const f = computeUnderdogFacts(
      underdogBaseFromSnapshot(snap, KICKOFF, NOW)!,
      [{ kind: "absences", favorite: 4, underdog: 0 }]
    );
    expect(f.signals.map((s) => s.kind)).toEqual(["absences", "jev"]);
    expect(f.model.jevApplied).toBe(true);
  });
});

describe("buildFactsBlock", () => {
  it("ids estáveis e o texto delimitado", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    const expected = [
      "P1",
      "P2",
      "P3",
      "S1",
      "S2",
      "S3",
      ...f.scenarios.map((_, i) => `C${i + 1}`),
      "F1",
      "M1",
    ];
    expect([...b.ids]).toEqual(expected);
    expect(b.text).toContain("<<<FATOS>>>");
    expect(b.text).toContain("<<<FIM_FATOS>>>");
    for (const id of expected) expect(b.text).toContain(`[${id}]`);
    expect(b.text).toContain("Flamengo venceu 3 dos últimos 5 confrontos");
    expect(b.text).toContain("Dixon-Coles");
  });

  it("allowed completo: chances, complemento, placares, cenários, minutos e o N", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    expect(b.allowed.percents).toEqual(
      expect.arrayContaining([
        Math.round(f.chances.underdog),
        Math.round(f.chances.draw),
        Math.round(f.chances.favorite),
        complementPct(f),
        ...f.scorelines.map((s) => s.pct),
        ...f.scenarios.flatMap((c) => [
          Math.round(c.beforePct),
          Math.round(c.afterPct),
        ]),
      ])
    );
    expect(b.allowed.scorelines).toEqual(
      expect.arrayContaining([
        ...f.scorelines.map((s) => scorelineKey(s.home, s.away)),
        "0-1",
      ])
    );
    expect(b.allowed.minutes).toEqual([30, 60]);
    expect(b.allowed.ratios).toEqual([Math.round(100 / f.chances.underdog)]);
  });

  it("números soltos e pares 'N dos últimos M' vêm só dos sinais e do bloco", () => {
    const b = buildFactsBlock(facts(), CTX);
    // Confronto 5 jogos: Flamengo 3, Palmeiras 1, empate 1; minutos 30 e 60.
    expect(b.allowed.numbers).toEqual(
      expect.arrayContaining([5, 3, 1, 30, 60])
    );
    expect(b.allowed.numbers).not.toContain(7);
    expect(b.allowed.pairs).toEqual(
      expect.arrayContaining([
        { who: "underdog", result: "W", n: 3, of: 5 },
        { who: "favorite", result: "W", n: 1, of: 5 },
        { who: "any", result: "D", n: 1, of: 5 },
      ])
    );
    expect(b.allowed.teams).toEqual({
      home: "Palmeiras",
      away: "Flamengo",
      underdog: "Flamengo",
      favorite: "Palmeiras",
    });
  });

  it("percentuais como o bloco os mostra (sem o valor cru)", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    expect(Number.isInteger(f.chances.underdog)).toBe(false);
    expect(b.allowed.percents).toContain(Math.round(f.chances.underdog));
    expect(b.allowed.percents).not.toContain(f.chances.underdog);
    expect(
      complementPct({ chances: { underdog: 20.2, draw: 25.4, favorite: 54.4 } })
    ).toBe(79);
  });

  it("modelo simplificado sem JEV", () => {
    const f = {
      ...facts(),
      model: { source: "heuristic" as const, jevApplied: false },
    };
    const b = buildFactsBlock(f, CTX);
    expect(b.text).toContain("modelo simplificado");
    expect(b.text).not.toContain("Dixon-Coles");
    expect(b.text).toContain("sem ajuste do JEV");
  });
});
