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
