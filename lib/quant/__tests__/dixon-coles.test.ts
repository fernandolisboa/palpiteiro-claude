import { describe, expect, it } from "vitest";

import {
  dixonColesLambdas,
  fitDixonColes,
  type DcMatch,
} from "@/lib/quant/dixon-coles";

// Liga sintética com gols = arredondamento do valor esperado verdadeiro, em
// turno e returno repetidos: o ponto fixo deve recuperar a ORDEM de força e a
// vantagem de mando (> 1).
const TRUE_ATTACK: Record<string, number> = { A: 1.6, B: 1.1, C: 0.9, D: 0.6 };
const TRUE_DEFENCE: Record<string, number> = { A: 0.6, B: 0.9, C: 1.1, D: 1.5 };
const GAMMA = 1.3;

function syntheticLeague(): DcMatch[] {
  const teams = Object.keys(TRUE_ATTACK);
  const out: DcMatch[] = [];
  let day = 0;
  for (let rep = 0; rep < 6; rep++) {
    for (const h of teams) {
      for (const a of teams) {
        if (h === a) continue;
        day += 1;
        out.push({
          date: new Date(Date.UTC(2024, 0, 1) + day * 86_400_000),
          home: h,
          away: a,
          homeGoals: Math.round(GAMMA * TRUE_ATTACK[h] * TRUE_DEFENCE[a]),
          awayGoals: Math.round(TRUE_ATTACK[a] * TRUE_DEFENCE[h]),
        });
      }
    }
  }
  return out;
}

describe("fitDixonColes", () => {
  const matches = syntheticLeague();
  const asOf = new Date(
    matches[matches.length - 1].date.getTime() + 86_400_000,
  );

  it("recupera a ordem de ataque/defesa e mando > 1", () => {
    const m = fitDixonColes(matches, asOf)!;
    const atk = ["A", "B", "C", "D"].map((t) => m.attack.get(t)!);
    const def = ["A", "B", "C", "D"].map((t) => m.defence.get(t)!);
    expect(atk).toEqual([...atk].sort((x, y) => y - x));
    expect(def).toEqual([...def].sort((x, y) => x - y));
    expect(m.homeAdvantage).toBeGreaterThan(1);
    expect(m.rho).toBeGreaterThanOrEqual(-0.25);
    expect(m.rho).toBeLessThanOrEqual(0.25);
  });

  it("média geométrica do ataque = 1 (identificabilidade)", () => {
    const m = fitDixonColes(matches, asOf)!;
    const logMean =
      [...m.attack.values()].reduce((s, a) => s + Math.log(a), 0) /
      m.attack.size;
    expect(logMean).toBeCloseTo(0, 9);
  });

  it("ignora jogos do próprio dia e futuros (point-in-time)", () => {
    const cut = matches[20].date;
    const a = fitDixonColes(matches, cut)!;
    const b = fitDixonColes(matches.slice(0, 20), cut)!;
    expect(a.attack.get("A")).toBeCloseTo(b.attack.get("A")!, 12);
  });

  it("sem jogos na janela → null; time sem histórico → λ null", () => {
    expect(fitDixonColes(matches, matches[0].date)).toBeNull();
    const m = fitDixonColes(matches, asOf)!;
    expect(dixonColesLambdas(m, "A", "Z")).toBeNull();
    const l = dixonColesLambdas(m, "A", "D")!;
    expect(l.lambdaHome).toBeGreaterThan(l.lambdaAway);
  });

  it("determinístico", () => {
    const x = fitDixonColes(matches, asOf)!;
    const y = fitDixonColes(matches, asOf)!;
    expect(x.rho).toBe(y.rho);
    expect(x.homeAdvantage).toBe(y.homeAdvantage);
  });
});
