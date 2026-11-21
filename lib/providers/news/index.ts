import { getNewsCombined } from "./combined";
import type { NewsProvider } from "./types";

// Factory do provider DEDICADO de notícias (ADR 0032 / #377), espelhando
// getAbsencesProvider (ADR 0026). RSS do ge por time primeiro, web search nativa da
// Claude como fallback (adendo #670, combined.ts). Nunca throw: qualquer falha vira um
// status (failed/none/no_search) e o palpite embarca sem notícias (mirror absences).
let cached: NewsProvider | undefined;

export function getNewsProvider(): NewsProvider {
  if (cached) return cached;
  cached = {
    getNewsByMatch: getNewsCombined,
  };
  return cached;
}

/**
 * Test seam: overrides the memoized news provider. `undefined` clears it so the next
 * `getNewsProvider()` rebuilds. Production MUST NOT call this.
 */
export function __setNewsProviderForTesting(
  provider: NewsProvider | undefined,
): void {
  cached = provider;
}

export type {
  NewsProvider,
  NewsResult,
  NewsFetchOutcome,
  NewsFetchStatus,
  NewsSourceKind,
  NewsMatchContext,
  NewsAuditContext,
  NewsFetchOptions,
} from "./types";
export { NewsUnavailableError } from "./types";
