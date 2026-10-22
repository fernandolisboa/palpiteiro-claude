import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import { templatedBetExplanation } from "@/lib/ai/bet-slip-explain/fallback";
import {
  checkExplanationFidelity,
  checkExplanationLanguage,
} from "@/lib/ai/bet-slip-explain/fidelity";
import { buildBetExplainInput } from "@/lib/bets/explain-input";

import {
  comboInput,
  leg,
  simplesInput,
  slipRow,
  snapshot,
  TEAMS,
} from "./fixtures";

const base = {
  teams: TEAMS,
  competition: "Brasileirão",
  kickoffLabel: "qua, 22/10 às 21:30",
};

const CASES = {
  simples: simplesInput(),
  combinada: comboInput(),
  "sem odd": buildBetExplainInput({
    ...base,
    slips: [slipRow([leg({ userOdd: null })])],
    snapshot: null,
  }),
  "abaixo do piso e incoerente": buildBetExplainInput({
    ...base,
    slips: [
      slipRow([leg({ marketImpliedPct: "53.00", referenceOdd: "1.800" })]),
    ],
    snapshot: snapshot(),
  }),
  "sua análise": buildBetExplainInput({
    ...base,
    slips: [
      slipRow([
        leg({
          gradeSource: "cartridge",
          modelSource: null,
          kind: "btts",
          params: { selection: "no" } as BetLegParams,
        }),
      ]),
    ],
    snapshot: null,
  }),
};

describe("templatedBetExplanation (#562)", () => {
  it.each(Object.entries(CASES))(
    "%s: passa nas próprias guardas",
    (_l, input) => {
      const out = templatedBetExplanation(input);
      expect(checkExplanationFidelity(out, input)).toEqual({ ok: true });
      expect(checkExplanationLanguage(out)).toEqual({ ok: true });
    }
  );

  it("um texto por perna, o aviso do backtest no resumo e a combinada quando há", () => {
    const s = templatedBetExplanation(CASES.simples);
    expect(s.pernas.map((p) => p.indice)).toEqual([0, 1]);
    expect(s.resumo).toContain("não bateu as odds de fechamento");
    expect(s.resumo).toContain("JEV");
    expect(s.combinada).toBeNull();
    expect(templatedBetExplanation(CASES.combinada).combinada).toContain(
      "31,5%"
    );
    expect(
      templatedBetExplanation(CASES["sua análise"]).pernas[0].texto
    ).toContain("da sua análise com IA");
  });
});
