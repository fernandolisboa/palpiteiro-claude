/**
 * Navegação rápida (#639): o cache do roteador no cliente (`staleTimes` em
 * next.config.ts) mostra na hora uma página já visitada, e o `RevisitRefresh` de cada
 * página relê o servidor em segundo plano quando o que está na tela já tem idade.
 *
 * A idade é medida no relógio do navegador, nunca contra a hora do servidor (relógio
 * do celular errado não pode decidir nada): cada render do servidor manda um id
 * novo, e o cliente anota quando viu aquele id pela primeira vez. Montar de novo um id
 * já visto = a página veio do cache.
 */

/** Idade a partir da qual uma página reaberta do cache é relida em segundo plano. */
export const REVISIT_MAX_AGE_MS = 30_000;

/** Jogo ao vivo: reaberto do cache, relê sempre (o placar muda a cada minuto). */
export const LIVE_REVISIT_MAX_AGE_MS = 1_000;

// Ids vistos guardados por 1h: depois disso o cache do roteador (5 min) já descartou
// a página, então o id nunca mais monta.
const SEEN_TTL_MS = 60 * 60 * 1000;

const firstSeen = new Map<string, number>();
let staleBefore = 0;

/**
 * Chamado quando a página monta (ou volta a ficar visível). `true` = o que está na
 * tela é velho e deve ser relido em segundo plano.
 */
export function shouldRevalidate(
  renderId: string,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  const seen = firstSeen.get(renderId);
  if (seen === undefined) {
    prune(now);
    firstSeen.set(renderId, now);
    return false;
  }
  return now - seen >= maxAgeMs || seen < staleBefore;
}

/**
 * Uma gravação que não passa pelo servidor (sem revalidatePath nem refresh, como o
 * "Analisar meu palpite") deixa as páginas guardadas desatualizadas: as que já
 * estavam no cache são relidas quando reabertas, sem re-renderizar a tela atual.
 */
export function markRouterCacheStale(now: number = Date.now()): void {
  staleBefore = now + 1;
}

function prune(now: number): void {
  for (const [id, seen] of firstSeen) {
    if (now - seen > SEEN_TTL_MS) firstSeen.delete(id);
  }
}

/** Só pros testes. */
export function resetRouterCacheState(): void {
  firstSeen.clear();
  staleBefore = 0;
}
