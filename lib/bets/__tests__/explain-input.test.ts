import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import { buildBetExplainInput } from "@/lib/bets/explain-input";

import {
  comboInput,
  leg,
  simplesInput,
  slipRow,
  snapshot,
  TEAMS,
} from "@/lib/ai/bet-slip-explain/__tests__/fixtures";

const base = {
  teams: TEAMS,
  competition: "Brasileirão",
  kickoffLabel: "qua, 22/10 às 21:30",
};

describe("buildBetExplainInput (#562)", () => {
  it("simples: uma perna por slip, na ordem do registro, números re-derivados das rows", () => {
    const i = simplesInput();
    expect(i.mode).toBe("simples");
    expect(i.legs.map((l) => [l.index, l.label])).toEqual([
      [0, "Mais de 2,5 gols"],
      [1, "Vitória do Flamengo"],
    ]);
    const [over, home] = i.legs;
    expect(over.modelProbPct).toBe(56.2);
    expect(over.breakEvenPct).toBeCloseTo(100 / 1.95, 6);
    expect(over.evPct).toBeCloseTo((0.562 * 1.95 - 1) * 100, 6);
    expect(over.reading).toBe("positive");
    expect(over.reference).toMatchObject({ odd: 1.9, impliedPct: 50.1 });
    expect(over.reference?.edgePp).toBeCloseTo(6.1, 6);
    expect(over.suggestedStakeUnits).toBe(1);
    expect(home.reading).toBe("negative");
    expect(home.coherenceWarning).toBe(false);
    expect(home.userStakeUnits).toBe(2);
    expect(i.lines).toEqual([2.5]);
    expect(i.scorelineSource).toBe("dixon_coles");
    expect(i.combo).toBeNull();
  });

  it("JEV da base gravada no registro: frases dos fatores que moveram o λ, sem números", () => {
    const { jev } = simplesInput();
    expect(jev?.kind).toBe("applied");
    if (jev?.kind !== "applied") return;
    expect(jev.phrases).toHaveLength(1);
    expect(jev.phrases[0]).toContain("Palmeiras");
    expect(jev.phrases.join(" ")).not.toMatch(/\d/);
  });

  it.each([
    ["sem base gravada", null, "no_base"],
    [
      "JEV fora da janela",
      snapshot({ jevStatus: "not_attempted" }, null),
      "not_attempted",
    ],
    ["JEV falhou", snapshot({ jevStatus: "failed" }, null), "failed"],
    ["JEV com ajuste", snapshot(), "applied"],
  ] as const)("%s → jev %s", (_l, snap, kind) => {
    const i = buildBetExplainInput({
      ...base,
      slips: [slipRow([leg()])],
      snapshot: snap,
    });
    expect(i.jev?.kind).toBe(kind);
  });

  it("JEV respondido sem mexer em nada → no_change", () => {
    const flat = snapshot(
      {},
      Object.fromEntries(
        Object.entries(snapshot().judgments!.answers!).map(([k, v]) => [
          k,
          { ...v, value: 0.1 },
        ])
      ) as never
    );
    const i = buildBetExplainInput({
      ...base,
      slips: [slipRow([leg()])],
      snapshot: flat,
    });
    expect(i.jev).toEqual({ kind: "no_change" });
  });

  it("só pernas da sua análise → sem bloco do JEV e fonte 'analysis'", () => {
    const i = buildBetExplainInput({
      ...base,
      slips: [slipRow([leg({ gradeSource: "cartridge", modelSource: null })])],
      snapshot: snapshot(),
    });
    expect(i.jev).toBeNull();
    expect(i.scorelineSource).toBeNull();
    expect(i.legs[0].source).toBe("analysis");
  });

  it("perna sem número (no_data / not_covered) fica de fora", () => {
    const i = buildBetExplainInput({
      ...base,
      slips: [
        slipRow([leg({ gradeStatus: "no_data", modelProbPct: null })]),
        slipRow([leg({ id: "leg-2" })], { id: "slip-2" }),
      ],
      snapshot: null,
    });
    expect(i.legs).toHaveLength(1);
    expect(i.legs[0].index).toBe(0);
  });

  it("sem a sua odd: sem EV nem break-even, veredito noOdd", () => {
    const i = buildBetExplainInput({
      ...base,
      slips: [slipRow([leg({ userOdd: null })])],
      snapshot: null,
    });
    expect(i.legs[0]).toMatchObject({
      userOdd: null,
      evPct: null,
      breakEvenPct: null,
      reading: "noOdd",
    });
  });

  it("odd de mercado e a sua odd com sinais opostos → coherenceWarning", () => {
    const i = buildBetExplainInput({
      ...base,
      slips: [
        slipRow([leg({ marketImpliedPct: "60.00", referenceOdd: "1.600" })]),
      ],
      snapshot: null,
    });
    expect(i.legs[0].coherenceWarning).toBe(true);
    expect(i.legs[0].reference?.belowFloor).toBe(true);
  });

  it("combinada: pernas sem odd/stake/veredito próprios; a conjunta e o EV da combinada", () => {
    const i = comboInput();
    expect(i.mode).toBe("combinada");
    expect(
      i.legs.every((l) => l.inCombo && l.userOdd === null && l.reading === null)
    ).toBe(true);
    expect(i.legs[1].label).toBe("Ambas marcam: sim");
    expect(i.combo).toMatchObject({
      jointProbPct: 31.5,
      userOdd: 3.4,
      userStakeUnits: 1,
    });
    expect(i.combo?.evPct).toBeCloseTo((0.315 * 3.4 - 1) * 100, 6);
    expect(i.combo?.reading).toBe("positive");
    // A conjunta sai da matriz: sem base gravada, o bloco diz isso.
    expect(i.jev).toEqual({ kind: "no_base" });
  });

  it("perna de linha em string (jsonb antigo) ainda entra nas linhas", () => {
    const i = buildBetExplainInput({
      ...base,
      slips: [
        slipRow([
          leg({
            params: {
              selection: "under",
              line: "3.5",
            } as unknown as BetLegParams,
          }),
        ]),
      ],
      snapshot: null,
    });
    expect(i.lines).toEqual([3.5]);
  });
});
