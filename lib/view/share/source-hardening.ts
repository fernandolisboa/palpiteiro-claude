// Endurece as fontes de notícia (`PalpiteHeadlineView.sources`) pro boundary público /p
// (ADR 0035 §8 / #384). As fontes são tool output {title,url} (não prosa do LLM), mas no
// /p são públicas — então: o TÍTULO passa pelo firewall público (unsafeForPublic: valor +
// "%" + decimal solto), a URL precisa ser https, e exibimos só o HOSTNAME + a query/fragment
// são STRIPPADOS (no-referrer / sem leak de params). Render com rel="nofollow".

import { unsafeForPublic } from "@/lib/view/share/public-text-guard";

export type HardenedSource = {
  title: string;
  hostname: string;
  href: string;
};

/**
 * Filtra + endurece as fontes pro /p (ADR 0035 §8). Cada fonte é DESCARTADA quando:
 *   - o título é inseguro pro público (unsafeForPublic: linguagem de valor OU "%" OU
 *     decimal solto — "Bet365 paga 3.5" cai);
 *   - a URL não parseia (new URL throw) ou não é https.
 * Para as sobreviventes: `href` = origin+pathname (query+fragment strippados), `hostname`
 * = url.hostname (exibição só do host). `[]` em undefined/vazio.
 */
export function hardenSources(
  sources: Array<{ title: string; url: string }> | undefined,
): HardenedSource[] {
  if (!sources || sources.length === 0) return [];
  const out: HardenedSource[] = [];
  for (const s of sources) {
    // Firewall do título: valor OU "%" OU decimal → drop.
    if (unsafeForPublic(s.title)) continue;
    let url: URL;
    try {
      url = new URL(s.url);
    } catch {
      continue; // URL malformada → drop.
    }
    if (url.protocol !== "https:") continue; // só https.
    out.push({
      title: s.title,
      hostname: url.hostname,
      // origin + pathname: strippa query (?…) e fragment (#…) — sem leak de params.
      href: url.origin + url.pathname,
    });
  }
  return out;
}
