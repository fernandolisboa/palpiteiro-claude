import { bttsCartridge } from "./btts";
import { matchResultCartridge } from "./match_result";
import { overUnderCartridge } from "./over_under";
import type { MarketCartridge } from "./types";

// Registry de cartuchos de mercado, keyed por `marketKey` (`"over_under"`). NÃO é
// o enum legado `over_under_2_5`. over/under é o primeiro (Tier 1); novos mercados
// (1X2, BTTS, dupla chance) entram aqui registrando seu cartucho, sem ramificar
// predict.ts.
const REGISTRY: Record<string, MarketCartridge> = {
  [overUnderCartridge.marketKey]: overUnderCartridge as MarketCartridge,
  [matchResultCartridge.marketKey]: matchResultCartridge as MarketCartridge,
  [bttsCartridge.marketKey]: bttsCartridge as MarketCartridge,
};

/**
 * Resolve o cartucho de um `marketKey`. LANÇA em chave desconhecida — um market
 * não-registrado é bug de chamada, não algo a degradar (e roda ANTES da chamada
 * paga ao LLM em predict.ts, preservando o spend).
 */
export function getCartridge(marketKey: string): MarketCartridge {
  const cartridge = REGISTRY[marketKey];
  if (!cartridge) {
    throw new Error(`unknown market cartridge: '${marketKey}'`);
  }
  return cartridge;
}
