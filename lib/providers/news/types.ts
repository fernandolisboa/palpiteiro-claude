// Tipos do provider DEDICADO de notícias (ADR 0032 / #377), espelhando o seam
// estreito da AbsencesProvider (ADR 0026): uma categoria de DADO separada da
// SportsDataProvider gorda. Notícia é insumo do palpite embasado (ADR 0031), nunca
// um mercado liquidável novo (gate Tier 3 de pé, ADR 0025).

// Uma fonte REAL capturada de um bloco `web_search_tool_result` da Claude — só
// `{title, url}`. NUNCA inventada pelo LLM: é tool output, não prosa do modelo, então
// não pode carregar afirmação de valor por construção (firewall, ADR 0030/0032).
export type NewsResult = {
  title: string;
  url: string;
};

// O resultado da busca de notícias de uma partida. `unavailable=true` ⇒ provider
// inerte (sem key, capability off) — degrada gracioso pra `results: []`, NUNCA bloqueia
// o palpite (mirror absences). `aiCall` é o id da row de auditoria logada pelo adapter
// (null se o log de auditoria falhou — o palpite ainda embarca).
export type NewsFetchOutcome = {
  results: NewsResult[];
  aiCall: { id: string } | null;
  unavailable: boolean;
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

// Interface ESTREITA do provider de notícias (ADR 0032), análoga à AbsencesProvider.
// Um único método; key-gated/inerte como o fallback SportMonks dos desfalques.
export interface NewsProvider {
  getNewsByMatch(
    ctx: NewsMatchContext,
    audit: NewsAuditContext,
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
