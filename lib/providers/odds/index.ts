import { ApiFootballOddsAdapter } from "@/lib/providers/odds/api-football/adapter";
import { OddsFallbackProvider } from "@/lib/providers/odds/fallback-provider";
import { TheOddsApiAdapter } from "@/lib/providers/odds/the-odds-api/adapter";
import type { OddsProvider } from "@/lib/providers/odds/types";

let cached: OddsProvider | undefined;

/**
 * Retorna o OddsProvider deste processo (memoizado na 1ª chamada). Composite (#289,
 * ADR 0025): roteia por capability entre o api-football (correct score, cauda) e a
 * The Odds API (cobre-tudo, caminho de hoje). O default (over/under/h2h/btts/…)
 * passa pela The Odds API byte-idêntico ao #288.
 */
export function getOddsProvider(): OddsProvider {
  if (!cached) {
    cached = new OddsFallbackProvider(
      new ApiFootballOddsAdapter(), // primary: cauda (bet_10/BR)
      new TheOddsApiAdapter(), // fallback: cobre-tudo
    );
  }
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

export { TheOddsApiAdapter, ApiFootballOddsAdapter, OddsFallbackProvider };
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
