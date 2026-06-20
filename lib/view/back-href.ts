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
 * searchParams). SÓ aceita uma rota interna sob algum `base` permitido: igual à
 * base (`/jogos`), com query sob ela (`/jogos?…`) OU um segmento de path sob ela
 * (`/time/Brazil` sob base `/time`). Rejeita absoluto (`https://…`),
 * protocol-relative (`//…`) e outra rota (`/jogosX`, `/admin`) — anti
 * open-redirect (o delimitador `?`/`/` impede que `/jogosX` passe por `/jogos`).
 *
 * `base` aceita string única (caso comum) ou lista (uma página de detalhe pode ser
 * alcançada de origens distintas — ex.: /match abre de /jogos OU de /time/[team]).
 * O fallback é a PRIMEIRA base (a origem default).
 *
 * Hardening (#408 review): mesmo sob uma base válida, o arm de path-segment
 * (`${b}/…`) rejeita traversal/normalização — `..` (sobe diretório: `/time/../admin`),
 * `//` (segmento protocol-relative-ish: `/time//evil.com`) e `\` (truque de path
 * Windows). Defense-in-depth: o pior caso já é interno+gateado, mas um "voltar" só
 * deve recompor a lista de origem, nunca pular pra outra rota. Nomes de time com
 * barra chegam `%2F`-encoded no `back` (o producer usa `encodeURIComponent`), então
 * não há `/` literal extra — o caso legítimo sobrevive.
 */
export function resolveBackHref(
  back: string | undefined,
  base: string | string[],
): string {
  const bases = Array.isArray(base) ? base : [base];
  const fallback = bases[0];
  if (!back || back.includes("..") || back.includes("//") || back.includes("\\")) {
    return fallback;
  }
  if (
    bases.some(
      (b) => back === b || back.startsWith(`${b}?`) || back.startsWith(`${b}/`),
    )
  ) {
    return back;
  }
  return fallback;
}
