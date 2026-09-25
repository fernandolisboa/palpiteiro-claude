// Keys curtas de liga usadas em URL (?league=) e na UI. Nova liga = nova key aqui
// (e os Records exaustivos em lib/format.ts / lib/view/league-picker.ts quebram o
// build até serem preenchidos).
export const LEAGUE_KEYS = [
  "bsa", "ucl", "wc", "sa", "bl", "l1", "lib", "sula", "epl", "laliga",
] as const;
export type LeagueKey = (typeof LEAGUE_KEYS)[number];
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
  // Nome EXIBIDO (traduzido PT-BR p/ Copa via displayTeamName, #340). Display-only.
  team: string;
  // Nome CANÔNICO cru (= matches.homeTeam/awayTeam) — chave de identidade do time
  // (#408): a row da classificação linka /time/[teamKey] (não /time/[team], que na
  // Copa estaria traduzido). Igual a `team` p/ clubes; difere só na Copa.
  teamKey: string;
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
  return (LEAGUE_KEYS as readonly string[]).includes(input ?? "")
    ? (input as LeagueKey)
    : "all";
}

// ─── "Analise minha aposta" — leitor de valor selection-pinned (#412, ADR 0034) ──
// View do mapper PURO (lib/view/grade-my-bet.ts), tipos client-safe espelhando
// BestBetView. UNION DISCRIMINADO por `kind`. NB: os estados de FALHA da ação
// (rate-limited / input-invalido / nao-analisavel / match-nao-encontrado) NÃO vivem
// aqui — moram no union de RETORNO da action (GradeMyBetResult com ok:boolean),
// espelhando AnalyzeMatchResult. Este View cobre só o que o mapper produz a partir
// de uma aposta JÁ aceita pelos gates.
export type GradeMyBetView =
  // Coberto E (snapshot completo OU seleção recomendada com persistido): edge
  // (PERSISTIDO se pinned===recommendation, alimentando display E stake do MESMO
  // número; senão recomputado), EV@userOdd PRIMÁRIO, break-even, stake, lucro,
  // valueReading derivado SÓ de sign(EV@userOdd).
  | {
      kind: "grade-coberto";
      pinnedLabel: string; // outcomeLabel da seleção fixada ("Over 2.5"/"Casa")
      marketLabel: string; // marketLabel do registry ("Over/Under gols")
      line: number | null;
      userOdd: number;
      valueReading: string; // template-derivado de sign(EV@userOdd) — NUNCA prosa do LLM
      edge: number | null; // edge do NOSSO board (null se snapshot incompleto)
      edgeLabel: string; // "+7.3pp" | "—"
      evPerUnit: number; // computeEvPerUnit(modelProbPct, userOdd) DIRETO
      breakEvenProbPct: number; // computeBreakEvenProbPct(userOdd)
      stakeUnits: number; // do MESMO número que alimenta o edge-display
      stakeLabel: string; // rótulo do stake primário
      // Sob coherenceWarning o stake-de-nosso-edge sai SÓ aqui (secundário), nunca
      // como manchete; null quando não há divergência de sinal.
      secondaryStakeLabel: string | null;
      profitIfWon: number; // profitForOutcome('won', userOdd, stakeUnits)
      coherenceWarning: boolean; // edge!==null && sign(EV@userOdd)!==sign(edge)
      modelProbPct: number;
      impliedProbPct: number | null;
      createdAt: string;
    }
  // Coberto, não-recomendada, board incompleto: edge='—' (honesto), EV@userOdd +
  // break-even + lucro AINDA presentes (canal odd-do-usuário independe do board);
  // stake = 1u "dimensionamento de mercado".
  | {
      kind: "degradado-sem-snapshot";
      pinnedLabel: string;
      marketLabel: string;
      line: number | null;
      userOdd: number;
      valueReading: string;
      edgeLabel: string; // "—" (sempre, sem snapshot)
      evPerUnit: number;
      breakEvenProbPct: number;
      stakeUnits: number; // 1u
      stakeLabel: string; // "dimensionamento de mercado"
      profitIfWon: number;
      modelProbPct: number;
      createdAt: string;
    }
  // Mercado/linha/seleção que NÃO modelamos (fail-closed, skip-not-fabricate §8).
  | { kind: "nao-avalio"; reason: string };

// ─── "Aposta livre" — perna do CAMINHO B (modelo de placar) (#471, ADR 0036) ─────
// View do mapper PURO (lib/view/free-bet.ts) da perna gradeada pelo double-Poisson
// determinístico. Espelha a disciplina de GradeMyBetView (registro Análise, números
// de valor legítimos), mas SEM edge/implícita: perna B não tem board completo → sem
// de-vig (ADR 0018) → `edgeLabel` é SEMPRE "—" e NUNCA se deriva pseudo-implícita de
// 1/userOdd (Decisão 3). O canal odd-do-usuário (EV/break-even/lucro price-only) só
// aparece quando o usuário deu odd. Os estados de FALHA da action (parse-falhou/
// slip-invalido/nao-analisavel/limite-de-slips/rate-limited) vivem no union de retorno
// da action, não aqui.
export type FreeBetLegView =
  | {
      kind: "grade-modelo-simplificado";
      selectionLabel: string; // "Placar exato: 2 a 0"
      sourceLabel: string; // "modelo simplificado" | "modelo simplificado (dados limitados)"
      modelProbPct: number; // 0-100, congelado no write
      edgeLabel: "—"; // SEMPRE — perna B não tem canal de edge
      settleBadge: string; // "conferimos após o jogo"
      // Canal odd-do-usuário (price-only §2/§3). null = usuário não deu odd → prob-only.
      value: {
        userOdd: number;
        valueReading: string; // template-derivado de sign(EV@userOdd) — NUNCA prosa do LLM
        evPerUnit: number; // computeEvPerUnit(modelProbPct, userOdd)
        breakEvenProbPct: number; // computeBreakEvenProbPct(userOdd)
        profitIfWon: number; // profitForOutcome('won', userOdd, 1)
      } | null;
    }
  // Standings indisponível/degenerado no grade → não avalio (prefer-skip, NUNCA λ fabricado).
  | { kind: "nao-avalio"; selectionLabel: string; reason: string };

// ─── "Aposta livre" — combinada same-game via joint-sum (#473, ADR 0036 Dec. 4) ──
// A conjunta vem SEMPRE de UMA matriz coerente (modelo simplificado). INVARIANTE DE
// COERÊNCIA DE TELA (PINADO): o card exibe o joint E as marginais Poisson das pernas
// participantes — TODAS da MESMA matriz → `joint ≤ min(marginais)`. EV só com odd
// combinada E joint computável (nunca EV parcial — Decisão 4c). Sem edge (perna B).
export type FreeBetComboView =
  | {
      kind: "combinada";
      jointProbPct: number; // 0-100, congelado no write
      sourceLabel: string; // "modelo simplificado" | "... (dados limitados)"
      // As marginais Poisson das pernas participantes, MESMA matriz do joint. O card
      // as renderiza JUNTO do joint (a forma-dura é joint sem elas na mesma tela).
      legs: { selectionLabel: string; marginalPct: number }[];
      // Canal odd-combinada (price-only). null = usuário não deu odd → só a conjunta.
      value: {
        comboUserOdd: number;
        valueReading: string; // template-derivado de sign(EV) — NUNCA prosa do LLM
        evPerUnit: number; // computeEvPerUnit(jointProbPct, comboUserOdd)
        breakEvenProbPct: number; // computeBreakEvenProbPct(comboUserOdd)
        profitIfWon: number; // profitForOutcome('won', comboUserOdd, 1)
      } | null;
    }
  // Alguma perna fora da matriz (1º tempo/first_to_score/cards/corners), sem grade, OU
  // standings indisponível → NUNCA precifica um combo diferente do apostado.
  | { kind: "combinada-nao-avaliada"; reason: string };
