import { bttsCartridge } from "./btts";
import { correctScoreCartridge } from "./correct_score";
import { doubleChanceCartridge } from "./double_chance";
import { matchResultCartridge } from "./match_result";
import { overUnderCartridge } from "./over_under";
import { overUnderCartridgeV3 } from "./over_under/index-v3";
import type { MarketCartridge } from "./types";

// Registry de cartuchos de mercado, keyed por `marketKey` (`"over_under"` = a key
// de markets.key; o ex-enum `over_under_2_5` saiu na Fase 5). over/under é o
// primeiro (Tier 1); novos mercados
// (1X2, BTTS, dupla chance) entram aqui registrando seu cartucho, sem ramificar
// predict.ts.
const REGISTRY: Record<string, MarketCartridge> = {
  [overUnderCartridge.marketKey]: overUnderCartridge as MarketCartridge,
  [matchResultCartridge.marketKey]: matchResultCartridge as MarketCartridge,
  [bttsCartridge.marketKey]: bttsCartridge as MarketCartridge,
  [doubleChanceCartridge.marketKey]: doubleChanceCartridge as MarketCartridge,
  [correctScoreCartridge.marketKey]: correctScoreCartridge as MarketCartridge,
};

// Variantes MULTI-LINHA (#175): cartuchos alternativos keyed por marketKey,
// consultados SÓ quando `opts.extraLines` está ligado. Tabela DATA-DRIVEN — predict
// não ramifica por `if (marketKey === 'over_under')`. Mercados sem variante caem no
// base mesmo com a flag ligada (a flag é inerte por default; só o over_under tem v3).
const EXTRA_LINES_VARIANTS: Record<string, MarketCartridge> = {
  [overUnderCartridgeV3.marketKey]: overUnderCartridgeV3 as MarketCartridge,
};

/**
 * Resolve o cartucho de um `marketKey`. LANÇA em chave desconhecida — um market
 * não-registrado é bug de chamada, não algo a degradar (e roda ANTES da chamada
 * paga ao LLM em predict.ts, preservando o spend).
 *
 * `opts.extraLines` (#175): quando ligado E existe uma variante multi-linha pra
 * este marketKey, devolve a variante (ex.: over_under → over_under_v3.0). Caso
 * contrário, devolve o cartucho base — preservando o comportamento dos callers de
 * 1 argumento (caminho default, byte-idêntico).
 */
export function getCartridge(
  marketKey: string,
  opts?: { extraLines?: boolean },
): MarketCartridge {
  if (opts?.extraLines) {
    const variant = EXTRA_LINES_VARIANTS[marketKey];
    if (variant) return variant;
  }
  const cartridge = REGISTRY[marketKey];
  if (!cartridge) {
    throw new Error(`unknown market cartridge: '${marketKey}'`);
  }
  return cartridge;
}
