// Curadoria de domínios pra web search de notícias (ADR 0032 §3, #377). Restringe a
// busca a fontes reputadas de futebol — BR + grandes internacionais — pra melhorar o
// sinal e a confiança nas citações. Começa curado; EXPANDE COM O TEMPO (uma fonte mal
// curada = sinal ruim). Vira `allowed_domains` na web search tool (request-builder).
export const ALLOWED_DOMAINS: readonly string[] = [
  // Brasil
  "ge.globo.com",
  "espn.com.br",
  "lance.com.br",
  "uol.com.br",
  "cnnbrasil.com.br",
  "gazetaesportiva.com",
  // Internacional
  "bbc.com",
  "theguardian.com",
  "reuters.com",
  "espn.com",
  "goal.com",
] as const;

// ─── Partições DECORRELACIONADAS pra liquidação de cartões (#394, ADR 0033) ──────────
//
// A extração web-grounded de cartões roda DUAS vezes (A≡B), cada uma contra um POOL DE
// DOMÍNIOS DISJUNTO — não dois clones byte-idênticos. A = imprensa BR, B = imprensa
// internacional: buscas fisicamente distintas. Liquida só se A.count === B.count E a
// união de ORIGENS editoriais distintas (colapsadas) >= 2 (extract-cards-from-web.ts).
// IMPORTANTE (ADR 0033 addendum §4): cartões têm UMA súmula oficial upstream, então A≡B
// é CONCORDÂNCIA de VEÍCULOS, não corroboração independente — a proteção real é
// skip-on-disagreement + attempt-cap + override. NÃO reusar ALLOWED_DOMAINS (news segue
// usando a lista plana); estes são pools separados de propósito.
export const CARD_DOMAINS_BR: readonly string[] = [
  "ge.globo.com",
  "espn.com.br",
  "lance.com.br",
  "uol.com.br",
  "cnnbrasil.com.br",
  "gazetaesportiva.com",
] as const;

export const CARD_DOMAINS_INTL: readonly string[] = [
  "bbc.com",
  "theguardian.com",
  "reuters.com",
  "espn.com",
  "goal.com",
] as const;
