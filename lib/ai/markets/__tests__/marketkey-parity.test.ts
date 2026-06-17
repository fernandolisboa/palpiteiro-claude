import { describe, expect, it } from "vitest";

import { anytimeScorerCartridge } from "@/lib/ai/markets/anytime_scorer";
import { assistCartridge } from "@/lib/ai/markets/assist";
import { bttsCartridge } from "@/lib/ai/markets/btts";
import { correctScoreCartridge } from "@/lib/ai/markets/correct_score";
import { doubleChanceCartridge } from "@/lib/ai/markets/double_chance";
import { matchResultCartridge } from "@/lib/ai/markets/match_result";
import { overUnderCartridge } from "@/lib/ai/markets/over_under";
import {
  ANYTIME_SCORER,
  ASSIST,
  BTTS,
  CORRECT_SCORE,
  DOUBLE_CHANCE,
  MATCH_RESULT,
  OVER_UNDER,
} from "@/lib/odds/market-descriptor";

// A view (lib/view/analysis.ts) roteia o caminho binário CONGELADO por um LITERAL
// "over_under" (não pode importar market-descriptor — pureza de bundle pinada por
// presentation.test.ts). Estes asserts pinam o espelho: se alguém renomear
// OVER_UNDER.dbMarketKey ou overUnderCartridge.marketKey, ESTE teste fica vermelho
// e aponta pro literal da view (#174 code review, finding 2).
describe("marketKey ↔ descriptor identity (espelho do literal da view)", () => {
  it("over_under: o literal 'over_under' da view casa com a const E o cartucho", () => {
    expect(OVER_UNDER.dbMarketKey).toBe("over_under");
    expect(overUnderCartridge.marketKey).toBe("over_under");
  });

  it("todo cartucho tem marketKey === descriptor.dbMarketKey (invariante de roteamento)", () => {
    for (const cartridge of [
      overUnderCartridge,
      matchResultCartridge,
      bttsCartridge,
      doubleChanceCartridge,
      correctScoreCartridge,
      anytimeScorerCartridge,
      assistCartridge,
    ]) {
      expect(cartridge.marketKey).toBe(cartridge.descriptor.dbMarketKey);
    }
  });

  it("as keys de descriptor são as esperadas (over_under/match_result/btts/double_chance/correct_score/anytime_scorer/assist)", () => {
    expect(MATCH_RESULT.dbMarketKey).toBe("match_result");
    expect(BTTS.dbMarketKey).toBe("btts");
    expect(DOUBLE_CHANCE.dbMarketKey).toBe("double_chance");
    expect(CORRECT_SCORE.dbMarketKey).toBe("correct_score");
    expect(correctScoreCartridge.marketKey).toBe("correct_score");
    expect(ANYTIME_SCORER.dbMarketKey).toBe("anytime_scorer");
    expect(ASSIST.dbMarketKey).toBe("assist");
    expect(anytimeScorerCartridge.marketKey).toBe("anytime_scorer");
    expect(assistCartridge.marketKey).toBe("assist");
  });
});
