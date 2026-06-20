/**
 * Preservação do estado de busca ao navegar lista → detalhe → voltar.
 *
 * O estado de filtro vive na query string da lista (/jogos: liga + date range;
 * /dashboard: status/liga/mercado). Ao abrir um item e voltar, o link de "voltar"
 * precisa recompor a URL da lista — senão o filtro reseta (links de "voltar" eram
 * hardcoded pra base). Anexamos a URL da lista como `?back=…` no link do detalhe;
 * o detalhe lê e valida. Funções puras (seam de teste sem render).
 */

/**
 * Anexa `?back=<listHref>` a um link de detalhe pra preservar a URL da lista de
 * origem. No-op quando não há filtro a preservar (`listHref` ausente ou === base)
 * → URL de detalhe limpa e os links de lista ficam byte-idênticos (goldens
 * intactos). `encodeURIComponent` protege os `?`/`&` internos da listHref.
 */
export function appendBackParam(
  detailHref: string,
  listHref: string | undefined,
  base: string,
): string {
  if (!listHref || listHref === base) return detailHref;
  const sep = detailHref.includes("?") ? "&" : "?";
  return `${detailHref}${sep}back=${encodeURIComponent(listHref)}`;
}

/**
 * Resolve o href de "voltar" a partir do `back` (já decodificado pelo Next em
 * searchParams). SÓ aceita uma rota interna sob `base` (`/jogos` ou `/jogos?…`):
 * rejeita absoluto (`https://…`), protocol-relative (`//…`) e outra rota (ex.:
 * `/jogosX`, `/admin`) — anti open-redirect. Qualquer coisa fora disso → `base`.
 */
export function resolveBackHref(
  back: string | undefined,
  base: string,
): string {
  if (back && (back === base || back.startsWith(`${base}?`))) return back;
  return base;
}
