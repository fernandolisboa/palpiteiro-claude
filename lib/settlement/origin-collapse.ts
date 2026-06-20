// Colapso de HOST → ORIGEM EDITORIAL (#394, ADR 0033) — o núcleo de correção do
// guardrail "≥2 origens distintas" da liquidação de cartões. Uma URL citada vira uma
// CHAVE de origem editorial; contar origens distintas exige colapsar variações de host
// da MESMA casa (espn.com + espn.com.br → 1; qualquer *.globo.com → 1) numa só chave.
//
// NÃO usar `split('.').slice(-2)` (a armadilha do eTLD+1): isso colapsaria espn.com.br →
// "com.br" (sufixo público), inflando origens distintas e quebrando o gate. A tabela
// abaixo é CURADA (eTLD+1 + identidade editorial) sobre os ~11 domínios das partições
// CARD_DOMAINS_BR/INTL. Host desconhecido → null (excluído da contagem de origens).
//
// SUB-COLAPSO é a direção SEGURA pra um gate de liquidação: tratar CNN Brasil e UOL como
// origens distintas (mesmo havendo sindicação editorial entre veículos) só TORNA o gate
// mais exigente; o perigo seria SOBRE-colapsar (esconder uma origem só atrás de dois
// nomes), que a tabela evita por ser explícita.
const ORIGIN_BY_ETLD1: Record<string, string> = {
  // *.globo.com (ge.globo.com, globoesporte.globo.com, …) → uma casa.
  "globo.com": "globo",
  // ESPN cross-cctld: espn.com E espn.com.br são a MESMA identidade editorial → "espn".
  "espn.com": "espn",
  "espn.com.br": "espn",
  "cnnbrasil.com.br": "cnnbrasil",
  "uol.com.br": "uol",
  "lance.com.br": "lance",
  "gazetaesportiva.com": "gazeta",
  "bbc.com": "bbc",
  "theguardian.com": "guardian",
  "reuters.com": "reuters",
  "goal.com": "goal",
};

/**
 * Mapeia uma URL pra sua CHAVE de origem editorial, ou null se o host for inválido ou
 * não estiver na tabela curada. Match por eTLD+1 EXATO ou por subdomínio
 * (`host === key` OU `host.endsWith("." + key)`) — nunca por fatiamento ingênuo de
 * sufixo público. `espn.com.br` casa o eTLD+1 exato "espn.com.br" → "espn" (e NUNCA
 * colapsa pra "com.br"). `sports.espn.com` casa `.espn.com` → "espn".
 */
export function hostToOrigin(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith("www.")) host = host.slice(4);

  // 1) eTLD+1 exato (pega espn.com.br ANTES de qualquer endsWith de espn.com).
  if (host in ORIGIN_BY_ETLD1) return ORIGIN_BY_ETLD1[host];

  // 2) Subdomínio de um eTLD+1 curado (ge.globo.com → .globo.com; sports.espn.com →
  //    .espn.com). `endsWith("." + key)` nunca casa um sufixo público cru.
  for (const [etld1, origin] of Object.entries(ORIGIN_BY_ETLD1)) {
    if (host.endsWith("." + etld1)) return origin;
  }

  return null;
}
