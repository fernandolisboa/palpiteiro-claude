import { getNewsByMatchViaWebSearch } from "./anthropic-web-search";
import type { NewsProvider } from "./types";

// Factory do provider DEDICADO de notícias (ADR 0032 / #377), espelhando
// getAbsencesProvider (ADR 0026). Hoje só há a implementação via web search nativa da
// Claude. Key-gated INERTE em paralelo ao SportMonks dos desfalques: sem chave Anthropic
// o adapter de baixo (hasKey() false) devolve unavailable:true — nunca throw. O palpite
// embarca sem notícias (mirror absences).
let cached: NewsProvider | undefined;

export function getNewsProvider(): NewsProvider {
  if (cached) return cached;
  cached = {
    getNewsByMatch: getNewsByMatchViaWebSearch,
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
  NewsMatchContext,
  NewsAuditContext,
} from "./types";
export { NewsUnavailableError } from "./types";
