/**
 * Navegação rápida (#639): o cache do roteador no cliente (`staleTimes` em
 * next.config.ts) mostra na hora uma página já visitada, e o `RevisitRefresh` de cada
 * página relê o servidor em segundo plano quando o que está na tela já tem idade.
 *
 * A idade é medida no relógio do navegador, nunca contra a hora do servidor (relógio
 * do celular errado não pode decidir nada): cada render do servidor manda um id
 * novo, e o cliente anota quando viu aquele id pela primeira vez. Montar de novo um id
 * já visto = a página veio do cache. Página buscada antes de montar (mouse em cima, ver
 * `IntentLink`) conta a idade da busca, não da montagem.
 */

/** Idade a partir da qual uma página reaberta do cache é relida em segundo plano. */
export const REVISIT_MAX_AGE_MS = 30_000;

/** Jogo ao vivo: reaberto do cache, relê sempre (o placar muda a cada minuto). */
export const LIVE_REVISIT_MAX_AGE_MS = 1_000;

// Limite por quantidade, não por idade: o voltar do navegador remonta páginas que o
// roteador guarda sem prazo (fora do `staleTimes`), e um id esquecido voltaria a
// contar como novo. 500 ids são muitas horas de navegação.
const MAX_SEEN_IDS = 500;
// Busca por intenção mais velha que a janela do cache do roteador (5 min) já não é
// reaproveitada: a navegação busca de novo.
const PREFETCH_REUSE_MS = 300_000;

const firstSeen = new Map<string, number>();
const prefetchedAt = new Map<string, number>();
let staleBefore = 0;

/**
 * Chamado quando a página monta (ou volta a ficar visível). `true` = o que está na
 * tela é velho e deve ser relido em segundo plano. `url` (caminho + query da página)
 * liga um id novo à busca por intenção que o trouxe.
 */
export function shouldRevalidate(
  renderId: string,
  maxAgeMs: number,
  now: number = Date.now(),
  url?: string,
): boolean {
  let seen = firstSeen.get(renderId);
  if (seen === undefined) {
    const fetched = url === undefined ? undefined : prefetchedAt.get(url);
    seen = fetched !== undefined && fetched < now ? fetched : now;
    remember(renderId, seen);
    if (seen === now) return false;
  }
  return now - seen >= maxAgeMs || seen < staleBefore;
}

/**
 * A busca completa de `url` (por intenção ou clique) começou agora. Se já houver uma
 * recente, o roteador a reaproveita em vez de buscar: fica a hora da primeira.
 */
export function notePrefetch(url: string, now: number = Date.now()): void {
  const prev = prefetchedAt.get(url);
  if (prev !== undefined && now - prev < PREFETCH_REUSE_MS) return;
  prefetchedAt.delete(url);
  prefetchedAt.set(url, now);
  while (prefetchedAt.size > MAX_SEEN_IDS) {
    prefetchedAt.delete(prefetchedAt.keys().next().value as string);
  }
}

/**
 * O cache do roteador foi limpo (`router.refresh()`): as buscas anotadas sumiram junto,
 * a próxima navegação busca de novo.
 */
export function notePrefetchCacheCleared(): void {
  prefetchedAt.clear();
}

/**
 * Uma gravação que não passa pelo servidor (sem revalidatePath nem refresh, como o
 * "Analisar meu palpite") deixa as páginas guardadas desatualizadas: as que já
 * estavam no cache são relidas quando reabertas, sem re-renderizar a tela atual.
 */
export function markRouterCacheStale(now: number = Date.now()): void {
  staleBefore = now + 1;
}

function remember(renderId: string, seen: number): void {
  firstSeen.set(renderId, seen);
  while (firstSeen.size > MAX_SEEN_IDS) {
    firstSeen.delete(firstSeen.keys().next().value as string);
  }
}

/** Só pros testes. */
export function resetRouterCacheState(): void {
  firstSeen.clear();
  prefetchedAt.clear();
  staleBefore = 0;
}

/** Chave de página (caminho + query) de um href do app, como o `location` a escreve. */
export function urlKey(href: string, base: string): string {
  const url = new URL(href, base);
  return url.pathname + url.search;
}
