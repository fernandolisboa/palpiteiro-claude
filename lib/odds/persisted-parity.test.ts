import { describe, expect, it } from "vitest";

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { OVER_UNDER } from "@/lib/odds/market-descriptor";
import {
  pickBestBookmaker,
  pickBestTotalsBookmaker,
} from "@/lib/odds/select-bookmaker";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";

// Paridade de STRINGS PERSISTIDAS: as colunas numeric do Postgres são gravadas
// como strings (.toFixed). O dual-write precisa produzir, pro mesmo bundle, EXATAMENTE
// as mesmas strings na tabela velha (par over/under) e na nova (linha por seleção).
// Aqui exercitamos o shaping de string dos dois caminhos a partir do MESMO bundle e
// exigimos igualdade estrita.

function event(
  over: number,
  under: number,
  title = "Pinnacle",
): NormalizedOddsEvent {
  return {
    id: "evt-1",
    commenceTime: "2026-05-15T19:00:00Z",
    homeTeam: "CR Flamengo",
    awayTeam: "Fluminense FC",
    bookmakers: [
      {
        key: "pinnacle",
        title,
        markets: [
          {
            key: "totals",
            lastUpdate: "2026-05-15T12:00:00Z",
            outcomes: [
              { name: "Over", price: over, point: 2.5 },
              { name: "Under", price: under, point: 2.5 },
            ],
          },
        ],
      },
    ],
  };
}

describe("persisted-string parity (old binary path vs new selection path)", () => {
  const cases: Array<[number, number]> = [
    [1.9, 1.95],
    [2.1, 1.74],
    [1.833, 1.987],
    [3.4, 1.33],
  ];

  it.each(cases)(
    "over=%s under=%s → identical odd + overround strings on both tables",
    (over, under) => {
      const evt = event(over, under);

      // Caminho NOVO: o bundle genérico + shaping da row de seleção.
      const bundle = pickBestBookmaker({
        event: evt,
        match: { homeTeam: evt.homeTeam, awayTeam: evt.awayTeam },
        descriptor: OVER_UNDER,
      })!;
      const newOver = bundle.selections.find((s) => s.key === "over")!;
      const newUnder = bundle.selections.find((s) => s.key === "under")!;
      const newOverroundPct = (bundle.overround * 100).toFixed(2);
      const newOverOddStr = newOver.odd.toFixed(3);
      const newUnderOddStr = newUnder.odd.toFixed(3);

      // Caminho VELHO: pickBestTotalsBookmaker binário + a math de overround do
      // legado, agora pelo core N-ário com [over, under] (wrapper removido na Fase 5).
      const binary = pickBestTotalsBookmaker(evt)!;
      const { overround } = computeMarketImpliedProbabilities([
        binary.overOdd,
        binary.underOdd,
      ]);
      const oldOverroundPct = (overround * 100).toFixed(2);
      const oldOverOddStr = binary.overOdd.toFixed(3);
      const oldUnderOddStr = binary.underOdd.toFixed(3);

      expect(newOverOddStr).toBe(oldOverOddStr);
      expect(newUnderOddStr).toBe(oldUnderOddStr);
      expect(newOverroundPct).toBe(oldOverroundPct);
      // bookmaker title idêntico (é o que persiste em ambas as tabelas)
      expect(bundle.bookmakerTitle).toBe(binary.bookmakerTitle);
    },
  );
});
