import type { CacheStore } from "@/lib/cache/types";

// Coalescência de requests em voo por chave de cache. O cache dos providers só é
// preenchido quando a resposta volta: N chamadas CONCORRENTES pra mesma chave (o
// fan-out paralelo da análise, ou dois Server Components no mesmo render) erram o
// cache juntas e disparariam N requests iguais, gastando quota de API-Football /
// The Odds API à toa. Aqui a 1ª chamada busca e as demais aguardam a mesma promise.
// Escopo por CacheStore (testes injetam o próprio cache) e só enquanto a request está
// em voo: resolvida ou rejeitada, a entrada sai do mapa — erro não fica memorizado.
const inFlightByCache = new WeakMap<CacheStore, Map<string, Promise<unknown>>>();

export function coalesceInFlight<T>(
  cache: CacheStore,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  let inFlight = inFlightByCache.get(cache);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByCache.set(cache, inFlight);
  }
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const map = inFlight;
  const promise = fetcher().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
}
