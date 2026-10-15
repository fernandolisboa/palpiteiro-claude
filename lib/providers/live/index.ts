import { ApiFootballLiveStateProvider } from "./api-football";
import type { LiveStateProvider } from "./types";

// Factory do estado ao vivo (#591), no molde de getAbsencesProvider (ADR 0026). Um
// provider só, sem cascata (decisão 2 do PLAN-580: placar, minuto e expulsões vêm da
// API-Football; falhou, volta null). Memoizado por instância.

let cached: LiveStateProvider | undefined;

export function getLiveStateProvider(): LiveStateProvider {
  cached ??= new ApiFootballLiveStateProvider();
  return cached;
}

/**
 * Test seam: troca o provider memoizado. `undefined` limpa, e o próximo
 * `getLiveStateProvider()` recria o default. Produção NÃO chama isto.
 */
export function __setLiveStateProviderForTesting(
  provider: LiveStateProvider | undefined,
): void {
  cached = provider;
}

export { ApiFootballLiveStateProvider };
export type {
  LiveProviderName,
  LiveStateProvider,
  LiveStateRequest,
  NormalizedLiveState,
} from "./types";
