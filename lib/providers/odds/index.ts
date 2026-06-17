import { TheOddsApiAdapter } from "@/lib/providers/odds/the-odds-api/adapter";
import type { OddsProvider } from "@/lib/providers/odds/types";

let cached: OddsProvider | undefined;

/**
 * Retorna o OddsProvider deste processo (memoizado na 1ª chamada). #288 entrega
 * um único adapter (The Odds API); #289 adiciona o 2º provider + um
 * OddsFallbackProvider AQUI, espelhando `getSportsDataProvider` (ADR 0025).
 */
export function getOddsProvider(): OddsProvider {
  if (!cached) cached = new TheOddsApiAdapter();
  return cached;
}

/**
 * Test seam: sobrescreve o provider memoizado. `undefined` limpa o cache pra a
 * próxima `getOddsProvider()` reconstruir. Produção NÃO deve chamar — sublinhado
 * de propósito (espelha `__setSportsDataProviderForTesting`).
 */
export function __setOddsProviderForTesting(
  provider: OddsProvider | undefined,
): void {
  cached = provider;
}

export { TheOddsApiAdapter };
export type {
  OddsProvider,
  OddsProviderCapabilities,
  NormalizedOddsEvent,
  NormalizedOddsEventListItem,
  NormalizedOddsBookmaker,
  NormalizedOddsMarket,
  NormalizedOddsOutcome,
  GetOddsForSportOptions,
  GetOddsForEventOptions,
  GetEventsForSportOptions,
} from "@/lib/providers/odds/types";
