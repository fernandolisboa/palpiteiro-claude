// Tipos do provider DEDICADO de notícias (ADR 0032 / #377), espelhando o seam
// estreito da AbsencesProvider (ADR 0026): uma categoria de DADO separada da
// SportsDataProvider gorda. Notícia é insumo do palpite embasado (ADR 0031), nunca
// um mercado liquidável novo (gate Tier 3 de pé, ADR 0025).

// De onde veio a notícia (ADR 0032, adendo #670). `ge` = RSS do ge por time (fonte
// primária pra time brasileiro); `web_search` = server tool da Claude (fallback).
export type NewsSourceKind = "ge" | "web_search";

// Uma fonte REAL: item do RSS do ge ou bloco `web_search_tool_result` da Claude. NUNCA
// inventada pelo LLM: é dado de feed/tool output, não prosa do modelo (firewall, ADR
// 0030/0032). Só `{title, url}` persiste (headline.sources); `snippet`/`publishedAt`
// vão só pro prompt da síntese (trecho curto, direito autoral: nunca exibido).
export type NewsResult = {
  title: string;
  url: string;
  // Trecho curto da matéria (linha fina ou começo do texto, ≤280 chars).
  snippet?: string;
  // Data de publicação (ISO).
  publishedAt?: string;
  source?: NewsSourceKind;
};

// Desfecho honesto do passo de notícias (#670): a UI e a síntese diferenciam "achou",
// "procurou e não tinha nada", "falhou" e "nem buscou".
//   found     — ≥1 notícia
//   none      — a fonte respondeu e não havia notícia do jogo
//   failed    — a fonte falhou (timeout, erro, sem chave, feed inválido)
//   skipped   — sem tempo pra buscar (decidido no caller)
//   no_search — o modelo respondeu sem rodar a web search
export type NewsFetchStatus = "found" | "none" | "failed" | "skipped" | "no_search";

// O resultado da busca de notícias de uma partida. NUNCA bloqueia o palpite (mirror
// absences): qualquer desfecho que não `found` degrada pra `results: []`. `via` = a
// fonte que respondeu (null quando nenhuma respondeu). `partial` = um feed de time
// respondeu e o outro falhou (meia falha, só no caminho do ge). `aiCall` é o id da row
// de auditoria da web search (null no RSS, que não é chamada de LLM, ou se o log falhou).
export type NewsFetchOutcome = {
  results: NewsResult[];
  aiCall: { id: string } | null;
  status: NewsFetchStatus;
  via: NewsSourceKind | null;
  partial?: boolean;
};

// Contexto mínimo da partida pra busca (nomes + liga + janela). Espelha o shape
// estreito que o passo de síntese já tem em mãos.
export type NewsMatchContext = {
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
};

// Auditoria mínima pra logar o ai_call da busca (mesma fronteira do generatePalpites:
// predict.ts é a única porta da LLM, ADR 0027).
export type NewsAuditContext = {
  userId: string;
  matchId: string;
};

// Opções da busca. `deadlineAt` (epoch ms) corta o timeout da chamada pelo que resta
// (lib/ai/deadline.ts): a síntese passa um prazo que guarda tempo pra manchete.
export type NewsFetchOptions = {
  deadlineAt?: number;
};

// Interface ESTREITA do provider de notícias (ADR 0032), análoga à AbsencesProvider.
// Um único método; key-gated/inerte como o fallback SportMonks dos desfalques.
export interface NewsProvider {
  getNewsByMatch(
    ctx: NewsMatchContext,
    audit: NewsAuditContext,
    options?: NewsFetchOptions,
  ): Promise<NewsFetchOutcome>;
}

// Erro transiente da busca de notícias — capturado no caller pra degradar gracioso
// (results:[]), nunca abortar o palpite. Espelha o padrão de erro estreito de absences.
export class NewsUnavailableError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "NewsUnavailableError";
    this.context = context;
  }
}
