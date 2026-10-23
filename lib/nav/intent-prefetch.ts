// Busca completa por intenção (#639, `IntentLink`): a mesma URL não é buscada de novo
// dentro desta janela. Sem isso, cada passada do mouse num jogo já aberto refazia a
// página no servidor (o roteador troca a entrada da navegação por uma busca completa).
const INTENT_PREFETCH_TTL_MS = 30_000;

const lastPrefetch = new Map<string, number>();

/**
 * `true` = pode buscar agora (e anota). `false` pra página atual ou já buscada há
 * menos de 30s.
 */
export function claimIntentPrefetch(
  href: string,
  current: { pathname: string; search: string },
  now: number = Date.now(),
): boolean {
  if (href === current.pathname + current.search) return false;
  const last = lastPrefetch.get(href);
  if (last !== undefined && now - last < INTENT_PREFETCH_TTL_MS) return false;
  for (const [key, at] of lastPrefetch) {
    if (now - at >= INTENT_PREFETCH_TTL_MS) lastPrefetch.delete(key);
  }
  lastPrefetch.set(href, now);
  return true;
}

/** Só pros testes. */
export function resetIntentPrefetch(): void {
  lastPrefetch.clear();
}
