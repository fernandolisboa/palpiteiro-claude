export type LeagueKey = "bsa" | "ucl" | "wc";
export type LeagueFilter = LeagueKey | "all";
// Token de DISPLAY da recomendação na tabela/lista. over/under/pass mantêm os
// tokens curtos pinados ("OVER"/"UNDER"/"PASS"); mercados novos (1X2, #173) derivam
// o display do selectionLabel da apresentação ("Casa"/"Empate"/"Fora"). Alargado
// p/ `string` pra cobrir qualquer mercado — REC_MAP fica total (sem TS2741) e o
// REC_CLASS de cor cai num default neutro pra tokens fora de over/under/pass.
export type Recommendation = string;

// Espelha matchStatusEnum (db/schema.ts). A view carrega o status pra decidir
// entre render agendado (odds + analisar) e encerrado (placar). `finished`
// mostra placar; `postponed`/`cancelled` precisam renderizar sãos (não como um
// 0–0 encerrado); `live`/em-andamento renderizam distinto via a badge "ao vivo"
// (status==='live' || isInProgress — #385). O enum DB segue inalterado; a
// analisabilidade permanece derivada de status+kickoff, NUNCA de isInProgress.
export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled";

export type Team = {
  name: string;
  short: string;
  hue: number;
  // Código de bandeira (ISO/subdivisão) p/ seleções da Copa (#341). Undefined em
  // clubes — o avatar cai nas iniciais. Display-only, resolve public/flags/wc/.
  flagCode?: string;
};

export type MatchRowView = {
  id: string;
  home: Team;
  away: Team;
  league: LeagueKey;
  kickoff: string;
  when: string;
  // Odds da linha como outcomes N-vias (#173 PR-2): cada seleção {label curto, odd}
  // na ordem canônica. over/under = 2 outcomes (byte-idêntico ao binário pré-#173;
  // golden pina); 1X2 = 3. Qual mercado a linha mostra ("prefere 1X2 quando há
  // captura h2h, senão over/under") é resolvido no mapper (toMatchRowOdds).
  odds: { outcomes: { label: string; odd: string }[] } | null;
  hasPrediction: boolean;
  status: MatchStatus;
  // DERIVADO (NÃO um status DB): jogo que JÁ apitou mas ainda não terminou,
  // dentro de IN_PROGRESS_WINDOW_MS (kickoff <= now < kickoff+3h e status ∉
  // {finished,cancelled,postponed}). Pega o jogo recém-apitado que o cron 6h
  // ainda não virou de `scheduled`. Dirige a badge "ao vivo"; NUNCA a
  // analisabilidade (essa é status+kickoff). Obrigatório — um false é decisão
  // deliberada do call site, não default acidental.
  isInProgress: boolean;
  // Placar final. Não-null só em jogos cujo provider já reportou gols
  // (tipicamente `finished`). null em scheduled/live/postponed/cancelled — e
  // mesmo num finished sem placar (dado faltando) — então a UI nunca inventa
  // um 0–0.
  homeScore: number | null;
  awayScore: number | null;
  venue?: string;
  countdown?: string;
};

export type MatchHeroView = MatchRowView;

// Uma seleção do card de odds ao vivo, 100% strings prontas pra render. Forma
// N-vias canônica (#173 PR-2): over/under expõe 2 outcomes, 1X2 expõe 3, na
// ordem canônica do mercado (market_selections.sortOrder, resolvida no reader).
export type OddsOutcomeView = {
  label: string; // "Over 2.5" | "Casa" — outcomeLabel da apresentação (seed + linha)
  odd: string; // "1.92"
  pct: string; // "50.7%" — implícita normalizada (Σ=1) do mercado completo
};

export type OddsView = {
  // `marketLabel` alimenta a badge do card ("Over/Under gols"/"Resultado (1X2)").
  // `outcomes` é a forma N-vias: o card renderiza grid-cols-{outcomes.length}.
  // over/under (N=2) é byte-idêntico ao binário pré-#173 (golden pina o DOM).
  marketLabel: string;
  outcomes: OddsOutcomeView[];
  bookmaker: string;
  overround: string;
  updatedAgo: string;
};

// Referência estruturada da aposta recomendada (multi-mercado). Labels vêm da
// apresentação de mercado (lib/view/markets/presentation.ts), que espelha o seed
// `markets.label`/`market_selections.label`. null em pass. Os componentes leem
// daqui (mercado + seleção + linha) — substituiu `kind`/`betSummary` no contract
// da view (#170).
export type BetReference = {
  marketKey: string; // "over_under" | "match_result" | …
  marketLabel: string; // "Over/Under gols" (seed markets.label)
  selectionKey: string; // "over" | "under" | "home" | …
  selectionLabel: string; // "Over" (seed market_selections.label)
  line: number | null; // 2.5 (over/under) | null (mercado sem linha)
  // Tradução LEIGA da aposta (lay-friendly): {market:"Mais de 2.5 gols",
  // plain:"pelo menos 3 gols no jogo"} — over/under; {market:selectionLabel,
  // plain:""} — 1X2 (sem frase leiga). Vem de presentation.betSummary; o
  // componente renderiza a sub-linha quando `plain` é não-vazio.
  betSummary: { market: string; plain: string } | null;
};

// Uma seleção do mercado, 100% strings prontas pra render (célula não-derivável
// = "—"). Forma N-vias canônica da view (ADR 0018): over/under expõe 2 outcomes,
// 1X2 expõe 3. Valores congelados da análise, consistentes byte-a-byte com
// ScenarioSideView (mesmo cálculo, mesmos formatters). `breakEven` é a ODD de
// equilíbrio pelo modelo (modelBreakEvenOdd), nunca a probabilidade.
export type OutcomeView = {
  id: string; // selectionKey
  label: string; // "Over 2.5" — label da apresentação (seed + linha)
  // Rótulo LEIGO da COLUNA de cenário ("mais de 2.5 gols" — over/under; "Casa"
  // — 1X2). Distinto de `label` ("Over 2.5"): preserva a frase do header de
  // coluna pré-pivot (paridade VISUAL). Vem de presentation.scenarioLabel.
  scenarioLabel: string;
  modelProb: string; // "58%"
  marketProb: string; // "50.7%" | "—"
  odd: string; // "1.92" | "—"
  edge: string; // "+7.3pp" | "—"
  expectedReturn: string; // "+11.4%" | "—"
  breakEven: string; // "1.72" — modelBreakEvenOdd; "—" quando modelProb ≤ 0
  isRecommended: boolean;
};

// Forma interna do bloco de cenários — 100% strings prontas pra render (célula
// não-derivável = "—"). Valores congelados da análise, nunca do snapshot vivo
// (ADR 0012). Usado só pelo mapper (toScenarioSideView → toOutcomeView); a view
// pública expõe `outcomes: OutcomeView[]`, não esta forma binária.
export type ScenarioSideView = {
  modelProb: string; // "58%" — prob. do modelo (label unificado; nunca "confidence")
  marketProb: string; // "50.7%" ou "—" — implied normalizada
  odd: string; // "1.92" ou "—" — odd congelada na análise
  edge: string; // "+7.3pp" ou "—"
  expectedReturn: string; // "+11.4%" ou "—"
  modelBreakEvenOdd: string; // "2.38" — odd de equilíbrio pelo modelo
};

export type AnalysisView = {
  // Referência multi-mercado da recomendação. null em pass — os componentes
  // detectam pass por `recommendation === null` (não mais por `kind`).
  recommendation: BetReference | null;
  // Todas as seleções do mercado como array (forma N-vias canônica). Vazio
  // quando o bloco de cenários degrada (confidence fora de domínio). over/under
  // → 2; 1X2 → 3. É a fonte única de cenários dos componentes.
  outcomes: OutcomeView[];
  minOdd: string | null;
  oddAtRec: string | null;
  oddAtRecAgo: string | null;
  bookmaker: string | null;
  expectedReturn: string | null;
  expectedReturnTone: "positive" | "neutral";
  evLegend: string | null;
  minEdgeLabel: string;
  // Piso de edge do mercado em pp (#290): 5 (partition) / 8 (scorer). Número PURO
  // pro AnalysisScenarios (footer + HelpHint do edge) — a view nunca hardcoda 5 pra
  // um mercado de piso 8. Vem de descriptor.minEdgePp; default 5 = byte-idêntico.
  minEdgePp: number;
  // Stake da recomendação no formato do dashboard ("1.00 u", sem sinal). null
  // em pass (não há aposta). #170 liga as duas call sites de toAnalysisView.
  stakeUnits: string | null;
  // Frase full-width abaixo do grid de cenários (subida de `scenarios` pro topo
  // — R4). over/under: break-even da zebra ou copy de margem de erro no pass.
  // null quando não derivável (histórica sem odd) ou mercado N-vias (1X2).
  framing: string | null;
  // Nota de degradação pra históricas sem o par congelado (idem, subida do topo).
  note: string | null;
  rationale: string;
  factors: string[];
  generatedAt: string;
  promptVersion: string;
  model: string;
  costUsd: string;
};

// Item da seção colapsável "análises anteriores" (#204): uma predição passada
// renderizada pelo <AnalysisResult/> existente + um header market-agnostic.
export type PreviousAnalysisItem = {
  // predictions.id — key React ESTÁVEL (NÃO o timestamp: reanálises do mesmo
  // minuto colidiriam numa key derivada do horário).
  id: string;
  // getMarketPresentation(marketKey).marketLabel — header market-agnostic (AC3): o
  // branch pass do AnalysisResult não imprime mercado, então o header identifica-o.
  marketLabel: string;
  // Rótulo preciso (com segundos) que desambigua reanálises do mesmo minuto.
  generatedAt: string;
  view: AnalysisView;
};

// Seção colapsável por mercado (#243): a ÚLTIMA análise de cada mercado de um jogo.
// Espelha PreviousAnalysisItem/BestBetEntry — `marketLabel` é SIBLING da view (não um
// campo dela): o branch pass do AnalysisResult não imprime mercado, então o título da
// seção o identifica (market-agnostic, do registry).
export type MarketAnalysisSectionItem = {
  // predictions.id — key estável p/ debugging/diffs; NÃO é a key React da seção (essa é
  // `marketKey`, p/ a seção sobreviver à reanálise sem remontar — #244).
  id: string;
  // marketKey CRU (coalesced 'over_under') — key React da seção (estável na reanálise) +
  // hidden input do form de reanálise por seção (#244).
  marketKey: string;
  marketLabel: string;
  // modelVersion CRU da análise (AIModelId) — semeia o dropdown do footer da seção com o
  // modelo que rodou aquela análise (#244). `view.model` é o display; aqui é o id.
  modelId: string;
  view: AnalysisView;
};

export type RecentPredictionView = {
  id: string;
  matchId: string;
  home: string;
  away: string;
  rec: Recommendation;
  edge: string | null;
  when: string;
  league: LeagueKey;
};

export type FormResult = "W" | "D" | "L";

export type FormViewRow = {
  name: string;
  results: FormResult[];
};

export type FormView = {
  home: FormViewRow;
  away: FormViewRow;
};

export type H2HViewRow = {
  date: string;
  h: string;
  a: string;
  s: string;
  // Key da seleção do mercado-lente (over/under: "over"/"under"; mercado não
  // baseado em gols: "" neutro). Alargado de "over"|"under" → string no #169 pra
  // a lente de H2H ser parametrizável por mercado (toH2HView); o consumidor
  // (h2h-section.tsx) só compara `=== "over"`, então segue compilando.
  tag: string;
};

export type H2HView = {
  rows: H2HViewRow[];
  summary: string;
};

export type StandingsViewRow = {
  pos: number;
  team: string;
  p: number;
  gf: number;
  ga: number;
  focus?: boolean;
};

export type StandingsView = {
  rows: StandingsViewRow[];
  round: string;
};

export type InjuriesViewSide = Array<{ name: string; status: string }>;

export type InjuriesView = {
  available: boolean;
  home: InjuriesViewSide;
  away: InjuriesViewSide;
};

export type LineupViewSide = {
  formation?: string;
  starters: string[];
};

export type LineupView = {
  available: boolean;
  home?: LineupViewSide;
  away?: LineupViewSide;
};

// ─── Melhor aposta do jogo (#178) ────────────────────────────────────────────
// Fan-out cross-mercado: N análises por jogo (uma por mercado), ranqueadas no
// cliente. Tipos PUROS (client-safe) — o painel "use client" recebe BestBetView
// como props e re-ordena sobre os numerics de `rank` (zero recompute). As chaves de
// `rank` LEEM os mesmos números que os cards mostram (edge da seleção recomendada via
// computeMarketScenarios; evPerUnit = computeEvPerUnit, o expectedReturn do card).
export type BestBetRank = {
  // Edge (pp) da seleção RECOMENDADA, na escala nativa do mercado (Σ=impliedSumTarget;
  // dupla chance = Σ2). É o número exibido no card. O sort divide por impliedSumTarget
  // pra comparabilidade cross-mercado (base Σ=1 por outcome coberto). null em pass/odds ausentes.
  edgePct: number | null;
  // EV por unidade = computeEvPerUnit(confidencePct, oddAtRecommendation) — o MESMO EV
  // que o card exibe (expectedReturn). Cross-comparável (overround-free). null em pass/odd ausente.
  evPerUnit: number | null;
  // Confiança do modelo na seleção recomendada (NOT NULL no schema). Em pass = prob do
  // lado recomendado por convenção; todo comparador por confiança é guardado por isPass.
  confidencePct: number;
  // Odd CONGELADA da recomendação (ADR 0012), nunca a odd ao vivo. null só em anomalia.
  oddAtRecommendation: number | null;
  // Do descriptor (data-driven): 1 (partição) | 2 (dupla chance). Base do /impliedSumTarget no sort.
  impliedSumTarget: number;
  isPass: boolean;
};

export type BestBetEntry = {
  marketKey: string;
  // getMarketPresentation(marketKey).marketLabel — load-bearing: renderizado acima de
  // TODO card (inclusive pass, cujo branch do AnalysisResult não imprime o label).
  marketLabel: string;
  analysis: AnalysisView; // renderizado pelo <AnalysisResult/> existente
  rank: BestBetRank;
};

export type BestBetMarketError = {
  marketKey: string;
  marketLabel: string;
  message: string;
};

export type BestBetView = {
  entries: BestBetEntry[]; // mercados com sucesso, na ordem-base (o cliente ordena)
  errors: BestBetMarketError[]; // falhas por-mercado (best-of-successful) + degrades de pré-warm
  llmCalls: number; // = entries.length (chamadas de LLM pagas de fato) — AC#2
  unavailableMarkets: number; // = errors.length (inclui rejeições pré-spend que NÃO pagaram)
};

export function parseLeagueFilter(input: string | undefined | null): LeagueFilter {
  if (input === "bsa" || input === "ucl" || input === "wc") return input;
  return "all";
}
