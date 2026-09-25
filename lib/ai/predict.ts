import { eq } from "drizzle-orm";

import {
  aiCalls,
  matches,
  predictionSelectionOdds,
  predictions,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  ensureScorerSelections,
  resolveMarketCatalog,
  resolveMarketRow,
} from "@/lib/db/queries/market-catalog";
import { getLatestFreshSelectionOddsSnapshots } from "@/lib/db/queries/odds-snapshots";
import { extractDbCause } from "@/lib/db/pg-error";
import {
  collectIndependentBinaries,
  deriveIndependentImplied,
  type IndependentBinaryBundle,
} from "@/lib/odds/collect-independent-binaries";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { pickBestBookmaker, type MarketOddsBundle } from "@/lib/odds/select-bookmaker";
import { getOddsProvider } from "@/lib/providers/odds";
import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import { getAbsencesProvider } from "@/lib/providers/absences";
import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import { pOverUnder, scorelineMatrix } from "@/lib/quant/scoreline-model";
import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedInjury,
  type NormalizedTeamLineup,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

import {
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";
import { findReusableJudgments } from "@/lib/db/queries/judgments";
import { isKellyStakingActive } from "@/lib/calibration/kelly-live";
import { getPreferredModelId } from "@/lib/db/queries/users";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

import {
  persistAiCallError,
  persistJudgmentAiCall,
  truncate,
} from "./ai-call-logging";
import { calculateCost } from "./cost";
import { AnalysisDeadlineError, canFitCall } from "./deadline";
import type { AnalysisEngine } from "./engine/analysis-engine";
import { readAnalysisEngine } from "./engine/analysis-engine-flag";
import {
  isCodeJevMarket,
  runCodeJevEngine,
  type CodeJevDecision,
} from "./engine/code-jev";
import {
  buildMatchJudgmentInput,
  previousFixture,
  type MatchJudgmentData,
  type MatchJudgmentInput,
} from "./engine/judgment-input";
import {
  resolveModelScoreline,
  type ModelScoreline,
} from "./engine/model-scoreline";
import type { PredictionJudgments } from "./engine/types";
import { JUDGMENT_WEIGHTS_VERSION } from "./judgments/apply";
import {
  judgeMatch,
  type JudgmentFailure,
} from "./judgments/judge-match";
import { createTypeSafeJudgmentProvider } from "./judgments/provider";
import { JUDGMENTS_VERSION } from "./judgments/questions";
import {
  buildJudgmentState,
  type JudgmentStateInput,
} from "./judgments/state";
import { judgmentStateHash } from "./judgments/state-hash";
import type { JudgmentAnswers } from "./judgments/types";
import { typeSafeErrorToAiCallStatus } from "./providers/typesafe/errors";
import {
  computeKellyStakeUnits,
  computeStakeUnits,
  isBelowEdgeFloor,
} from "./staking";
import {
  buildNarratorContext,
  judgmentFactorPhrases,
  narratorCartridge,
  selectionLabel,
  type NarratorContext,
  type NarratorDecision,
  type NarratorOutput,
} from "./markets/_narrator";
import { getCartridge } from "./markets/registry";
import type { BaseMarketOutput, MarketCartridge } from "./markets/types";
import {
  JUDGMENT_MODEL_ID,
  MODEL_REGISTRY,
  isAIProvider,
  isModelAllowedForAudience,
  type AIModel,
  type AIModelId,
} from "./models";
import { getProviderForModel } from "./providers";
import type { AiCallStatus, AnalysisRequest } from "./providers/types";

// Rationale neutro de um pass REBAIXADO pelo gate de edge (ADR 0038) — coerente com a
// manchete "sem aposta recomendada", em vez da prosa pró-lado do LLM (que fica em
// ai_calls.outputPayload pra auditoria). Determinístico, não vem do LLM.
const GATED_PASS_RATIONALE =
  "O modelo apontou um lado, mas a vantagem estimada (edge) ficou abaixo do piso mínimo — sem aposta recomendada.";

// ─── Types & errors ──────────────────────────────────────────────────────────

export type PredictArgs = {
  matchId: string;
  userId: string;
  // Audiência do caller (ADR 0013). Decide se a preferência pessoal do usuário
  // pode apontar pra um modelo admin-only: uma preferência fora da audiência
  // cai no default. NÃO afeta o `modelOverride` (já validado pelo caller).
  isAdmin: boolean;
  // Override admin-gated (já validado pelo caller); predict confia num
  // AIModelId. Ausente → usa a preferência do usuário / default global do DB.
  modelOverride?: AIModelId;
  // Mercado a analisar (ADR 0017). Default `"over_under"` (o caller único hoje
  // não passa). Resolve o cartucho via getCartridge — predict NÃO ramifica por
  // `if (market === X)`.
  marketKey?: string;
  // Flag das linhas extras de over/under (#175). Quando true, getCartridge devolve
  // a variante multi-linha (over_under_v3.0) onde existir. Lida na action a partir
  // de ai_config; predict só a repassa pro registry. Default false = caminho de hoje.
  extraLines?: boolean;
  // Prazo do run (epoch ms, lib/ai/deadline.ts), medido do início da action. Antes
  // de cada chamada paga predict confere se ainda cabe uma chamada do modelo
  // resolvido; se não, lança AnalysisDeadlineError SEM gastar (e sem cobrar slot).
  // O adapter corta timeout/retries pelo restante. Ausente = sem prazo.
  deadlineAt?: number;
};

// Opções do caller que não são dados da análise.
export type PredictOptions = {
  // Chamado logo ANTES de cada chamada paga ao LLM (análise ou narração), depois de
  // todas as falhas pré-gasto e do teste de prazo. Lança pra abortar sem gasto — é
  // onde o fan-out cobra o slot de rate-limit (o 1º já vem cobrado pela action).
  beforeLlmPath?: () => Promise<void>;
};

export type Prediction = typeof predictions.$inferSelect;

// Carrier do retorno do predict (gate #15): a prediction persistida + o marketKey
// resolvido + a grade N-vias (uma entrada por selectionKey, com a prob do modelo e
// a odd congelada). A action monta a view SÍNCRONA a partir de `selections` (o
// painel renderiza antes de qualquer re-query). `odd` é null se a seleção não tem
// odd no bundle (não acontece hoje — todo selectionKey vem do mercado completo).
export type PredictResult = {
  prediction: Prediction;
  marketKey: string;
  // `label` (nome do jogador) viaja só pra mercados dynamicSelections (#290) — a
  // view o prefere ao presentation.selectionLabel(key) (que devolveria a key crua
  // num mercado de seleções dinâmicas). Ausente pros mercados de partição.
  selections: {
    key: string;
    modelProbPct: number;
    odd: number | null;
    label?: string;
  }[];
};

export class PredictError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "PredictError";
    this.context = context;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FORM_LAST = 5;
const H2H_LAST = 5;
const ODDS_WINDOW_MS = 6 * 60 * 60 * 1000;

// Re-export normalizeTeamName for back-compat with any caller still importing
// it from this module (e.g. tests). Canonical location is now
// lib/providers/sports-data/team-names.ts.
export { normalizeTeamName };

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Odds matching ───────────────────────────────────────────────────────────

function findMatchingEvent(
  events: NormalizedOddsEvent[],
  homeName: string,
  awayName: string,
  kickoffAt: Date,
): NormalizedOddsEvent | undefined {
  const kickoffMs = kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commenceTime);
    if (!Number.isFinite(ts) || Math.abs(ts - kickoffMs) > ODDS_WINDOW_MS) {
      return false;
    }
    return (
      teamNamesMatch(event.homeTeam, homeName) &&
      teamNamesMatch(event.awayTeam, awayName)
    );
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function predict(
  args: PredictArgs,
  options: PredictOptions = {},
): Promise<PredictResult> {
  const outcome = await runPredict(args, options);
  if (outcome.kind !== "done") {
    // Inalcançável: sem `deferNarration`, o ramo code_jev narra e persiste.
    throw new PredictError("predict: decisão code_jev pendente sem pedido");
  }
  return outcome.result;
}

// ─── Best bet no motor code_jev (ADR 0041 §4, #512) ──────────────────────────

// λ + julgamentos JEV FIXADOS no run de best bet (keyed por matchId): o 1º mercado
// code_jev resolve, os seguintes reusam tudo em memória — exatamente UMA chamada JEV
// e UMA matriz por run, mesmo que desfalques/escalações/tabela mudem no provider
// entre um mercado e outro (sem busca de escalação anterior, sem lookup de reuso).
export type CodeJevRunMemo = Map<
  string,
  { scoreline: ModelScoreline; input: MatchJudgmentInput; run: JudgmentRun }
>;

export type BestBetPredictOptions = {
  // Motor fixado pelo orquestrador (lido UMA vez por run), pra um flip do flag no
  // meio do fan-out não misturar motores.
  engine: AnalysisEngine;
  runMemo: CodeJevRunMemo;
  // Chamado logo ANTES da chamada paga quando o mercado cai no caminho LLM (λ
  // indisponível), depois das falhas pré-gasto. Lança pra abortar sem gasto (slot
  // negado).
  beforeLlmPath?: () => Promise<void>;
};

// Decisão code_jev tomada, gateada e com a narração ADIADA (nada persistido ainda).
// O orquestrador escolhe UM mercado pra narrar (1 chamada paga) e persiste os
// demais com o racional templado.
export type PendingCodeJevPrediction = {
  marketKey: string;
  // Os MESMOS valores que a row vai gravar (toFixed de persistPrediction) → o rank
  // calculado daqui é idêntico ao que a view calcula da row persistida.
  rankInput: {
    recommendation: string;
    confidencePct: string;
    oddAtRecommendation: string | null;
    selections: PredictResult["selections"];
  };
  model: AIModel;
  userId: string;
  matchId: string;
  narratorDecision: NarratorDecision;
  narratorContext: NarratorContext;
  // Prazo do run (PredictArgs.deadlineAt), repassado à chamada narradora.
  deadlineAt?: number;
  persist: Omit<PersistArgs, "aiCallId" | "rationale" | "keyFactors">;
};

export type PredictOutcome =
  | { kind: "done"; result: PredictResult }
  | { kind: "pending"; pending: PendingCodeJevPrediction };

/**
 * Porta do best bet (#512): igual ao predict, mas no motor code_jev devolve a
 * decisão PENDENTE (sem narrar nem persistir). Mercado que cai no caminho LLM roda
 * inteiro (pago, persistido) e volta `done`.
 */
export async function predictForBestBet(
  args: PredictArgs,
  opts: BestBetPredictOptions,
): Promise<PredictOutcome> {
  return runPredict(args, { ...opts, deferNarration: true });
}

/**
 * A ÚNICA chamada paga do best bet code_jev: narra a decisão escolhida (logada em
 * ai_calls). Nunca bloqueia: falha do narrador → racional templado. Lança se o
 * insert de ai_calls falhar, se o prazo do run não comportar a chamada
 * (AnalysisDeadlineError, sem gasto) ou se o hook `beforeLlmPath` (slot) lançar.
 */
export async function narratePendingPrediction(
  pending: PendingCodeJevPrediction,
  options: PredictOptions = {},
): Promise<{ aiCallId: string; output: NarratorOutput }> {
  return narrateDecision({
    model: pending.model,
    userId: pending.userId,
    matchId: pending.matchId,
    decision: pending.narratorDecision,
    context: pending.narratorContext,
    deadlineAt: pending.deadlineAt,
    beforeLlmPath: options.beforeLlmPath,
  });
}

/**
 * Persiste uma decisão pendente. `narration` = a saída da chamada narradora DESTE
 * mercado; ausente = mercado não escolhido → racional templado em código (custo
 * zero), apontando pra row de ai_calls da narração do run (`aiCallId`).
 */
export async function persistPendingPrediction(
  pending: PendingCodeJevPrediction,
  args: { aiCallId: string; narration?: NarratorOutput },
): Promise<PredictResult> {
  const text =
    args.narration ?? narratorCartridge.fallback(pending.narratorDecision);
  const judgments = pending.persist.judgments;
  return persistPrediction({
    ...pending.persist,
    aiCallId: args.aiCallId,
    rationale: text.rationale,
    keyFactors: text.key_factors,
    judgments: judgments && {
      ...judgments,
      narration: args.narration ? "llm_call" : "best_bet_template",
    },
  });
}

type RunPredictOptions = Partial<BestBetPredictOptions> &
  PredictOptions & {
    deferNarration?: boolean;
  };

async function runPredict(
  {
    matchId,
    userId,
    isAdmin,
    modelOverride,
    marketKey = "over_under",
    extraLines = false,
    deadlineAt,
  }: PredictArgs,
  opts: RunPredictOptions,
): Promise<PredictOutcome> {
  // Cartucho de mercado (ADR 0017): resolve por marketKey (throw em desconhecido).
  // Read puro — roda ANTES de qualquer chamada paga; predict NÃO ramifica por
  // `if (market === X)`, todo o comportamento específico vem do cartucho. `extraLines`
  // (#175) seleciona a variante multi-linha onde houver (data-driven no registry).
  const cartridge = getCartridge(marketKey, { extraLines });

  // Fork data-driven (#290, ADR 0025 emenda): independent_binary (scorer/assist)
  // tem conjunto de jogadores ILIMITADO cotado só no yes — caminho próprio de
  // aquisição de odds (collectIndependentBinaries), implícita-teto e catálogo
  // lazy. NUNCA `if (market === X)`: o fork chaveia em marketKind.
  const isIndependentBinary =
    (cartridge.descriptor.marketKind ?? "partition") === "independent_binary";

  // 0. Resolve o modelo UMA vez pela cascata completa (ADR 0013):
  //    override por análise > preferência do usuário > default global >
  //    DEFAULT_MODEL_ID. A preferência só vale se passar no filtro de audiência
  //    (admin-only nunca roda pra usuário comum) e se ainda existir no registry
  //    (um id stale/removido — ex.: um modelo aposentado salvo no DB — é filtrado
  //    pra null por getPreferredModelId e cai no default). Havendo override, nem
  //    lemos a preferência. As leituras de DB são baratas ante a chamada ao LLM.
  let resolvedModelId: AIModelId;
  if (modelOverride) {
    resolvedModelId = modelOverride;
  } else {
    const pref = await getPreferredModelId(userId);
    const usablePref =
      pref && isModelAllowedForAudience(pref, isAdmin) ? pref : null;
    resolvedModelId = usablePref ?? (await getDefaultModelId());
  }
  const model = MODEL_REGISTRY[resolvedModelId];

  // 1. Lookup do match no DB
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PredictError("match not found", { matchId });
  }
  const kickoffMs = match.kickoffAt.getTime();
  // Pré-jogo = `scheduled` E kickoff no FUTURO (#385). `live`/`postponed` não têm
  // odds pré-jogo (ou data definida) e `finished`/`cancelled` já passaram —
  // allowlist (não denylist) pega qualquer status futuro. O 2º guard fecha o
  // jogo que apitou mas segue DB-`scheduled` por até ~6h (cron 0 */6 / sync lock):
  // o status sozinho deixaria gastar. As actions barram ANTES com copy por status;
  // aqui é defense-in-depth (predict é a porta NÃO-bypassável do LLM). `kickoffMs`
  // vai no context pra a action (friendlyMessage) escolher a copy "em andamento".
  if (match.status !== "scheduled") {
    throw new PredictError("match is not analyzable", {
      matchId,
      status: match.status,
      kickoffMs,
    });
  }
  if (kickoffMs <= Date.now()) {
    throw new PredictError("match is not analyzable", {
      matchId,
      status: match.status,
      kickoffMs,
    });
  }

  const provider = getSportsDataProvider();
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };

  // 2. Fetch normalized fixture (composite-keyed). Used to populate venue
  //    and serve as the reference for downstream lookups (lineups, injuries).
  const fixture = await provider.getFixtureByMatch(ref);
  if (!fixture) {
    throw new PredictError("fixture not found in provider", {
      matchId,
      ref,
      providerName: provider.capabilities.name,
    });
  }

  // 3. Parallel fetch of supporting data. The provider's adapters serialize
  //    HTTP calls through their concurrency + throttle limiters
  //    (lib/providers/http/), so the Promise.all here expresses logical
  //    independence; the transport layer enforces rate limits.
  //
  //    Injuries are wrapped in catch() to map both SportsDataUnsupportedError
  //    (capability missing, e.g. football-data.org has no injury endpoint) AND
  //    SportsDataTransientError (e.g. an api-football transient outage on the
  //    injuries route) to the same absences-unavailable signal for the AI input
  //    — the analysis proceeds and the LLM is told injuries are unavailable.
  //    This graceful degrade is scoped to ONLY the injuries fetch: every other
  //    fetch (form/h2h/standings/lineups) still rejects Promise.all on a
  //    transient error, and any non-transient/non-unsupported injuries error
  //    still bubbles up.
  const [homeForm, awayForm, h2h, standings, injuries, lineups] =
    await Promise.all([
      provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
      provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
      provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
      provider.getStandings(match.league),
      // Desfalques via AbsencesProvider (ADR 0026 D2, #227): seam estreito próprio,
      // separado das outras fetches (que seguem no SportsDataProvider). Sem
      // SPORTMONKS_API_TOKEN, a cascata = só o primário (wrapper da api-football) =
      // caminho de hoje. O MESMO catch() gate degrada pra unavailable.
      getAbsencesProvider()
        .getAbsencesByFixture(ref)
        .then((data) => ({ data, unavailable: false }))
        .catch((err: unknown) => {
          if (
            err instanceof SportsDataUnsupportedError ||
            err instanceof SportsDataTransientError
          ) {
            return {
              data: {
                home: [] as NormalizedInjury[],
                away: [] as NormalizedInjury[],
              },
              unavailable: true,
            };
          }
          throw err;
        }),
      provider.getLineups(ref),
    ]);
  // Per-side seam (#226, ADR 0026): hoje a fonte de desfalques é única (API-Football,
  // per-liga) → home e away compartilham a MESMA disponibilidade; divergem quando um
  // provider per-team/multi-source (oficial + fallback) aterrissar no #227. Threadar
  // separado já cria a fronteira sem mudar o comportamento atual.
  const absencesAvailableHome = !injuries.unavailable;
  const absencesAvailableAway = !injuries.unavailable;

  // 4. Odds (N-vias): reusa uma captura fresca se a página já snapshotou nesta
  //    sessão (quota: evita uma 2ª call à Odds API). Cai no fetch direto quando
  //    predict() roda standalone (script, sem render prévio). Ambos os caminhos
  //    produzem um `MarketOddsBundle` (selections[] keyed por selectionKey +
  //    overround) — over/under é o caso N=2. O caminho fresh já é dual-escrito
  //    pelo fetch-and-snapshot, então a paridade over/under é preservada.
  // oddsBundle é o bundle EFETIVO (linha única hoje; linha ESCOLHIDA no multi-linha,
  // fixado pós-output). `!` = definite-assignment: o single-line atribui aqui; o
  // multi-linha atribui após a escolha do LLM — ambos antes do 1º uso (edge).
  let oddsBundle!: MarketOddsBundle;
  // Bundle scorer (#290): jogadores cotados yes-only de UM book. Atribuído só no
  // caminho independent_binary; usado pra threadar selectionKeys/labels/implícita.
  let scorerBundle: IndependentBinaryBundle | undefined;
  // Multi-linha (#175): um bundle por linha candidata; o LLM escolhe a linha.
  let bundlesByLine: Map<number, MarketOddsBundle> | undefined;
  const candidateLines = cartridge.descriptor.candidateLines;
  if (isIndependentBinary) {
    // independent_binary (#290): batch /odds da liga pelo providerMarketKey
    // (bet_92/212) → o OddsFallbackProvider roteia pro ApiFootballOddsAdapter
    // (supportsMarket). collectIndependentBinaries escolhe o book com mais
    // jogadores, SEM complete-market gate, SEM overround. Nenhum snapshot fresco
    // (estes mercados não pré-aquecem por evento como btts) — fetch direto.
    const sportKey = leagueToSportKey(match.league);
    const commenceTimeFrom = new Date(kickoffMs - ODDS_WINDOW_MS).toISOString();
    const commenceTimeTo = new Date(kickoffMs + ODDS_WINDOW_MS).toISOString();
    const events = await getOddsProvider().getOddsForSport(sportKey, {
      markets: [cartridge.descriptor.providerMarketKey],
      regions: ["eu"],
      commenceTimeFrom,
      commenceTimeTo,
    });
    const event = findMatchingEvent(
      events,
      fixture.homeTeam,
      fixture.awayTeam,
      match.kickoffAt,
    );
    if (!event) {
      throw new PredictError("no matching odds event found", {
        home: fixture.homeTeam,
        away: fixture.awayTeam,
        kickoff: match.kickoffAt.toISOString(),
        candidates: events.length,
        market: cartridge.descriptor.dbMarketKey,
      });
    }
    scorerBundle = collectIndependentBinaries({
      event,
      descriptor: cartridge.descriptor,
    });
    if (!scorerBundle) {
      throw new PredictError(
        `no '${cartridge.descriptor.dbMarketKey}' player odds available for event`,
        { eventId: event.id, bookmakers: event.bookmakers.length },
      );
    }
  } else if (candidateLines) {
    // Lê o snapshot fresco POR linha (additional pré-aquecido por evento; ver
    // fetch-and-snapshot). Linha sem snapshot → omitida (escada parcial: analisa as
    // disponíveis). oddsBundle/oddByKey/impliedByKey finais saem da linha escolhida.
    bundlesByLine = new Map();
    for (const line of candidateLines) {
      const fresh = await getLatestFreshSelectionOddsSnapshots({
        matchId: match.id,
        dbMarketKey: cartridge.descriptor.dbMarketKey,
        params: { line },
      });
      if (!fresh) continue;
      const sels = fresh.selections.map((s) => ({
        key: s.key,
        odd: Number(s.odd),
      }));
      const { overround } = computeMarketImpliedProbabilities(
        cartridge.descriptor.selectionKeys.map((key) => {
          const sel = sels.find((s) => s.key === key);
          if (!sel) {
            throw new PredictError(
              `fresh snapshot missing selection '${key}' for market '${cartridge.descriptor.dbMarketKey}' line ${line}`,
              { matchId, key, line },
            );
          }
          return sel.odd;
        }),
      );
      bundlesByLine.set(line, {
        bookmakerKey: "",
        bookmakerTitle: fresh.bookmaker,
        lastUpdate: fresh.capturedAt.toISOString(),
        selections: sels,
        overround,
      });
    }
    if (bundlesByLine.size === 0) {
      throw new PredictError(
        `multi-line market '${cartridge.descriptor.dbMarketKey}' sem snapshots frescos; odds devem ser pré-aquecidas por evento antes do predict (nunca batch)`,
        { matchId, dbMarketKey: cartridge.descriptor.dbMarketKey, candidateLines },
      );
    }
  }
  const freshSnapshot =
    bundlesByLine || isIndependentBinary
      ? null
      : await getLatestFreshSelectionOddsSnapshots({
          matchId: match.id,
          dbMarketKey: cartridge.descriptor.dbMarketKey,
          params: cartridge.descriptor.params,
        });
  if (freshSnapshot) {
    // numeric → string no Drizzle; Number() na fronteira antes de qualquer math.
    const selections = freshSnapshot.selections.map((s) => ({
      key: s.key,
      odd: Number(s.odd),
    }));
    const { overround } = computeMarketImpliedProbabilities(
      cartridge.descriptor.selectionKeys.map((key) => {
        const sel = selections.find((s) => s.key === key);
        if (!sel) {
          throw new PredictError(
            `fresh snapshot missing selection '${key}' for market '${cartridge.descriptor.dbMarketKey}'`,
            { matchId, key },
          );
        }
        return sel.odd;
      }),
    );
    oddsBundle = {
      bookmakerKey: "", // não usado downstream; schema guarda title, não key.
      bookmakerTitle: freshSnapshot.bookmaker,
      lastUpdate: freshSnapshot.capturedAt.toISOString(),
      selections,
      overround,
    };
  } else if (
    !bundlesByLine &&
    !isIndependentBinary &&
    cartridge.descriptor.oddsSource === "additional"
  ) {
    // Mercado *additional* (btts): odds só por evento, NUNCA em batch (quota). O
    // snapshot fresco DEVE ter sido garantido por evento antes do predict (pre-warm
    // na action). Sem ele, NÃO batcheia getOddsForSport — falha explícita. Guard
    // data-driven (oddsSource do descriptor), não um literal de nome de mercado.
    throw new PredictError(
      `additional-market '${cartridge.descriptor.dbMarketKey}' sem snapshot fresco; odds devem ser garantidas por evento antes do predict (nunca batch)`,
      { matchId, dbMarketKey: cartridge.descriptor.dbMarketKey },
    );
  } else if (!bundlesByLine && !isIndependentBinary) {
    const sportKey = leagueToSportKey(match.league);
    const commenceTimeFrom = new Date(kickoffMs - ODDS_WINDOW_MS).toISOString();
    const commenceTimeTo = new Date(kickoffMs + ODDS_WINDOW_MS).toISOString();
    const events = await getOddsProvider().getOddsForSport(sportKey, {
      // provider market key do descriptor (= "totals" pro over/under); request
      // byte-idêntico ao literal antigo, mas sem hardcode no predict.
      markets: [cartridge.descriptor.providerMarketKey],
      regions: ["eu"],
      commenceTimeFrom,
      commenceTimeTo,
    });
    const event = findMatchingEvent(
      events,
      fixture.homeTeam,
      fixture.awayTeam,
      match.kickoffAt,
    );
    if (!event) {
      throw new PredictError("no matching odds event found", {
        home: fixture.homeTeam,
        away: fixture.awayTeam,
        kickoff: match.kickoffAt.toISOString(),
        candidates: events.length,
      });
    }
    const bundle = pickBestBookmaker({
      event,
      match: { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam },
      descriptor: cartridge.descriptor,
    });
    if (!bundle) {
      throw new PredictError(
        `no complete '${cartridge.descriptor.dbMarketKey}' odds available for event`,
        {
          eventId: event.id,
          bookmakers: event.bookmakers.length,
        },
      );
    }
    oddsBundle = bundle;
  }

  // 4b. Catálogo do mercado (marketId + mapas seleção↔id) — read PRÉ-chamada-paga,
  //     keyed por dbMarketKey (= "over_under", a key de markets.key).
  //     Hard-fail aqui (market sem seed) acontece ANTES de queimar spend e ANTES
  //     do insert de ai_call. A persistência (passo 11) só CONSOME estes mapas.
  //
  //     independent_binary (#290): resolve SÓ a row markets (resolveMarketRow, sem
  //     o hard-fail de zero-seleção) + materializa LAZY as seleções por jogador
  //     (ensureScorerSelections, pré-paid — falha de DB nunca queima spend), NUNCA
  //     re-entrando em resolveMarketCatalog. idByKey vem do upsert+re-read.
  let catalog: { marketId: string; idByKey: Map<string, string> };
  if (isIndependentBinary) {
    const row = await resolveMarketRow(cartridge.descriptor.dbMarketKey);
    const { idByKey } = await ensureScorerSelections(
      row.marketId,
      scorerBundle!.players.map((p) => ({ key: p.key, label: p.label })),
    );
    catalog = { marketId: row.marketId, idByKey };
  } else {
    const resolved = await resolveMarketCatalog(cartridge.descriptor.dbMarketKey);
    catalog = { marketId: resolved.marketId, idByKey: resolved.idByKey };

    // 4c. Guarda de seed COMPLETO — PRÉ-chamada-paga. resolveMarketCatalog (shared
    //     com #164) só hard-falha em mercado ausente ou ZERO seleções; um mercado
    //     seedado com SÓ ALGUMAS seleções (ex.: 'over' sem 'under') passaria por ela
    //     e só estouraria nos hard-fails por-seleção DEPOIS da chamada paga ao provider
    //     (queimando spend + uma row de ai_call). O invariante "falha antes do gasto"
    //     exige checar AQUI que TODA seleção do cartucho tem id no catálogo. PULADO
    //     pra dynamicSelections (as seleções crescem lazy; não há set estático a checar).
    const missingSelections = cartridge.selections.filter(
      (key) => !catalog.idByKey.has(key),
    );
    if (missingSelections.length > 0) {
      throw new PredictError(
        `market '${cartridge.descriptor.dbMarketKey}' seedado incompleto: faltam seleções [${missingSelections.join(", ")}]`,
        { marketKey, missingSelections },
      );
    }
  }

  // 5. Implied probabilities normalizadas (N seleções; contrato chave→índice).
  //    O candidate-odds array é montado na ordem `descriptor.selectionKeys`
  //    (['over','under'] / ['home','draw','away']) SOBRE as odds do bundle — nunca
  //    por ordem de linhas de read. `oddByKey` mapeia selectionKey→odd a partir das
  //    `bundle.selections`; impliedByKey indexa o resultado pela MESMA chave, e o
  //    *100 segue a ordem de operações de antes (probs[i] * 100) → bit-exato com o
  //    legado em N=2.
  //
  //    C7 (#290): selectionKeys é forkado por DADO — scorer usa as keys do bundle
  //    (descriptor.selectionKeys é [] pra dynamicSelections); partição é byte-idêntico.
  const selectionKeys = isIndependentBinary
    ? scorerBundle!.players.map((p) => p.key)
    : cartridge.descriptor.selectionKeys;
  // impliedSumTarget (ADR 0018 + emenda): 1 p/ partição (over/under, 1X2 — Σ=100,
  // bit-exato com o legado); 2 p/ dupla chance (cobertura sobreposta, Σ=200). O
  // core fica Σ=1; o fator é aplicado AQUI e no mesmo lugar da view
  // (computeMarketScenarios) → edge persistido == edge da grade.
  const impliedSumTarget = cartridge.descriptor.impliedSumTarget ?? 1;
  // `oddByKey`/`impliedByKey` de UM bundle, na ordem `descriptor.selectionKeys`
  // (SOBRE as odds do bundle — nunca por ordem de read). probs[i]*100*target →
  // bit-exato com o legado em N=2. Multi-linha chama por linha (escada) e de novo
  // na linha escolhida pós-output; single-line chama uma vez.
  const deriveImplied = (
    bundle: MarketOddsBundle,
  ): {
    oddByKey: Record<string, number>;
    impliedByKey: Record<string, number>;
  } => {
    const obk: Record<string, number> = {};
    for (const sel of bundle.selections) {
      obk[sel.key] = sel.odd;
    }
    const candidateOdds = selectionKeys.map((key) => {
      const odd = obk[key];
      if (odd === undefined) {
        throw new PredictError(
          `odds bundle missing selection '${key}' for market '${cartridge.descriptor.dbMarketKey}'`,
          { matchId, key },
        );
      }
      return odd;
    });
    const { probs } = computeMarketImpliedProbabilities(candidateOdds);
    const ibk: Record<string, number> = {};
    selectionKeys.forEach((key, i) => {
      ibk[key] = probs[i] * 100 * impliedSumTarget;
    });
    return { oddByKey: obk, impliedByKey: ibk };
  };
  // Finais (a linha ESCOLHIDA): single-line atribui já; multi-linha após o output.
  let oddByKey: Record<string, number> = {};
  let impliedByKey: Record<string, number> = {};

  // 5.5 (ADR 0037): baseline Poisson do modelo de placar como FATO estruturado pro
  //    cartucho over/under. Matriz UMA vez da tabela via o adapter promovido
  //    (lib/providers/sports-data/match-lambdas); ausente (undefined) quando standings
  //    indisponível/degenerado — escada de degradação, o cartucho roda como antes, zero
  //    regressão. Só over/under lê o bloco no v1; injetado via spread condicional pra
  //    não virar excess-property nos outros cartuchos (que ignoram o campo).
  const scorelineMatrixForMatch =
    cartridge.descriptor.dbMarketKey === "over_under"
      ? (() => {
          const lambdas = computeMatchLambdas({
            standing: standings,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            neutral: match.league === "world_cup",
          });
          if (!lambdas) return null;
          return {
            matrix: scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway),
            degraded: lambdas.degradedData,
          };
        })()
      : null;
  const scorelineModelForLines = (lines: number[]) =>
    scorelineMatrixForMatch
      ? {
          source: "poisson" as const,
          degraded: scorelineMatrixForMatch.degraded,
          perLine: lines.map((line) => ({
            line,
            overPct: pOverUnder(scorelineMatrixForMatch.matrix, line) * 100,
          })),
        }
      : undefined;

  // 5.6 Motor code_jev (ADR 0041, #511), atrás do flag `analysis_engine`: nos mercados
  //     partition que o código precifica, a decisão sai do λ (× julgamentos JEV) → matriz
  //     → max-edge, e o LLM só narra. Precisa da tabela (λ); sem ela, ou com o flag em
  //     'llm', ou em mercado não precificável → segue o caminho LLM abaixo, intacto.
  //     No best bet, o λ e os julgamentos do 1º mercado ficam fixados pro run (#512).
  const pinned = opts.runMemo?.get(matchId);
  const engineScoreline =
    isCodeJevMarket(cartridge.descriptor) &&
    (opts.engine ?? (await readAnalysisEngine())) === "code_jev"
      ? (pinned?.scoreline ??
        resolveModelScoreline({
          standing: standings,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          neutral: match.league === "world_cup",
        }))
      : null;
  if (engineScoreline) {
    // Candidatas = a linha única, ou cada linha da escada (multi-linha, #175): a
    // MESMA implícita de-vigada (deriveImplied) que o caminho LLM usa.
    const candidates = bundlesByLine
      ? [...bundlesByLine.entries()].map(([line, bundle]) => ({
          line,
          impliedByKey: deriveImplied(bundle).impliedByKey,
        }))
      : [
          {
            line: cartridge.descriptor.params?.line ?? null,
            impliedByKey: deriveImplied(oddsBundle).impliedByKey,
          },
        ];

    // JEV: uma chamada por JOGO (ADR 0041 §1), mas predict() roda por MERCADO (o
    // fan-out chama N vezes). No best bet, o que o 1º mercado resolveu fica fixado
    // no memo do run; senão runJudgments reusa as respostas de uma predição recente
    // do mesmo jogo com o mesmo state; só chama o JEV (fail-open, logado) quando não há.
    const { input: judgmentInput, run: jev } =
      pinned ??
      (await resolveMatchJudgments({
        userId,
        matchId,
        provider,
        data: {
          league: match.league,
          kickoffAt: match.kickoffAt,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          injuries: injuries.data,
          lineups,
          homeForm,
          awayForm,
          standings,
        },
      }));
    if (!pinned) {
      opts.runMemo?.set(matchId, {
        scoreline: engineScoreline,
        input: judgmentInput,
        run: jev,
      });
    }

    const minEdgePp = cartridge.descriptor.minEdgePp ?? MIN_EDGE_PP;
    const engine = runCodeJevEngine({
      dbMarketKey: cartridge.descriptor.dbMarketKey,
      selectionKeys,
      scoreline: engineScoreline,
      judgments: jev.answers,
      candidates,
      minEdgePp,
    });

    // Fixa a linha decidida pra todo o downstream (edge/PSO/persist), como o
    // caminho LLM faz com a linha escolhida pelo modelo.
    let marketParams: { line: number } | null;
    if (bundlesByLine) {
      const chosen =
        engine.line === null ? undefined : bundlesByLine.get(engine.line);
      if (!chosen || engine.line === null) {
        throw new PredictError("code_jev decidiu uma linha fora da escada", {
          marketKey,
          line: engine.line,
        });
      }
      oddsBundle = chosen;
      marketParams = { line: engine.line };
    } else {
      marketParams = cartridge.descriptor.params ?? null;
    }
    ({ oddByKey, impliedByKey } = deriveImplied(oddsBundle));

    // confidencePct = P(seleção recomendada) (ADR 0041 §6); num pass, P da 1ª
    // seleção — a mesma convenção dos cartuchos (P(over)/P(yes)/P(home)).
    const confidencePct =
      engine.modelProbByKey[
        engine.recommendation === "pass"
          ? selectionKeys[0]
          : engine.recommendation
      ];
    const decision = await decideRecommendation({
      cartridge,
      marketKey,
      catalog,
      selectionKeys,
      oddByKey,
      impliedByKey,
      modelProbByKey: engine.modelProbByKey,
      recommendation: engine.recommendation,
      confidencePct,
    });

    const teams = { home: match.homeTeam, away: match.awayTeam };
    const narratorDecision = toNarratorDecision({
      marketKey: cartridge.marketKey,
      selectionKeys,
      teams,
      engine,
      answers: jev.answers,
      decision,
      line: marketParams?.line ?? null,
      oddByKey,
      minEdgePp,
    });
    const narratorContext = buildNarratorContext({
      league: match.league,
      kickoffAt: match.kickoffAt,
      venue: fixture.venue,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      standings,
      homeForm,
      awayForm,
      h2h,
      absencesAvailable: !injuries.unavailable,
      absences: judgmentInput.absences,
    });

    const recModelProb = decision.recModelProb;
    const pending: PendingCodeJevPrediction = {
      marketKey: cartridge.marketKey,
      rankInput: {
        recommendation: decision.side,
        confidencePct: confidencePct.toFixed(2),
        oddAtRecommendation: decision.oddAtRec?.toFixed(3) ?? null,
        selections: selectionKeys.map((key) => ({
          key,
          modelProbPct: engine.modelProbByKey[key],
          odd: oddByKey[key] ?? null,
        })),
      },
      model,
      userId,
      matchId,
      narratorDecision,
      narratorContext,
      deadlineAt,
      persist: {
        matchId,
        userId,
        cartridge,
        catalog,
        selectionKeys,
        oddByKey,
        modelProbByKey: engine.modelProbByKey,
        marketParams,
        decision,
        confidencePct,
        // Odd mínima em que o lado ainda tem edge ≥ piso: 100 / (P_modelo − piso).
        minimumOdd:
          recModelProb !== null && recModelProb - minEdgePp > 0
            ? 100 / (recModelProb - minEdgePp)
            : undefined,
        bookmaker: oddsBundle.bookmakerTitle,
        modelVersion: codeJevModelVersion(model.id, engineScoreline),
        promptVersion: narratorCartridge.version,
        judgments: toPredictionJudgments(engineScoreline, engine, jev),
        labelByKey: null,
      },
    };
    // Best bet (#512): o orquestrador decide qual mercado narra (1 chamada paga).
    if (opts.deferNarration) return { kind: "pending", pending };

    // Narração paga fora do best bet: mesmo gate de prazo + hook de slot da análise
    // (dentro de narrateDecision, com os parâmetros de geração resolvidos).
    const narration = await narratePendingPrediction(pending, {
      beforeLlmPath: opts.beforeLlmPath,
    });
    return {
      kind: "done",
      result: await persistPendingPrediction(pending, {
        aiCallId: narration.aiCallId,
        narration: narration.output,
      }),
    };
  }

  // 6. Monta o input do cartucho. Args comuns (sports-data) idênticos pros dois
  //    caminhos; só odds/implied diferem (single: par binário; multi: escada).
  const commonInputArgs = {
    match: {
      externalId: match.externalId,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      venue: fixture.venue,
    },
    standings,
    home: {
      form: homeForm,
      injuries: injuries.data.home,
      absencesAvailable: absencesAvailableHome,
    },
    away: {
      form: awayForm,
      injuries: injuries.data.away,
      absencesAvailable: absencesAvailableAway,
    },
    lineups,
    h2h,
  };
  let input: ReturnType<typeof cartridge.buildPredictionInput>;
  try {
    if (isIndependentBinary) {
      // independent_binary (#290): oddByKey direto do bundle; implícita = TETO
      // (1/odd)*100 via deriveIndependentImplied — NUNCA computeMarketImpliedProbabilities
      // (normalização inaplicável). playerLabels carrega o nome pro cartucho.
      const players = scorerBundle!.players;
      for (const p of players) oddByKey[p.key] = p.odd;
      impliedByKey = deriveIndependentImplied(players);
      const playerLabels: Record<string, string> = {};
      for (const p of players) playerLabels[p.key] = p.label;
      input = cartridge.buildPredictionInput({
        ...commonInputArgs,
        odds: {
          bookmaker: scorerBundle!.bookmakerTitle,
          captured_at: new Date(scorerBundle!.lastUpdate).toISOString(),
          selections: players.map((p) => ({ key: p.key, odd: p.odd })),
          playerLabels,
        },
        implied: { pct: impliedByKey },
      });
    } else if (bundlesByLine) {
      // Multi-linha: monta a ESCADA (odds+implícita por linha) pro LLM ver e
      // escolher. oddByKey/impliedByKey/oddsBundle finais saem da linha escolhida,
      // fixados pós-output. selections/bookmaker/captured_at do GenericOddsArgs são
      // exigidos pelo tipo mas IGNORADOS pelo build-input v3 (lê lineLadder).
      const lineLadder = [...bundlesByLine.entries()].map(([line, bundle]) => {
        const derived = deriveImplied(bundle);
        return {
          line,
          bookmaker: bundle.bookmakerTitle,
          captured_at: new Date(bundle.lastUpdate).toISOString(),
          selections: selectionKeys.map((key) => ({
            key,
            odd: derived.oddByKey[key],
          })),
          impliedPct: derived.impliedByKey,
        };
      });
      const head = lineLadder[0];
      // Bloco Poisson espelhando as linhas da escada (ADR 0037). Spread condicional:
      // ausente quando standings indisponível → cartucho renderiza como antes.
      const v3Block = scorelineModelForLines(lineLadder.map((l) => l.line));
      input = cartridge.buildPredictionInput({
        ...commonInputArgs,
        odds: {
          bookmaker: head.bookmaker,
          captured_at: head.captured_at,
          selections: head.selections,
          lineLadder,
        },
        implied: { pct: head.impliedPct },
        ...(v3Block ? { scorelineModel: v3Block } : {}),
      });
    } else {
      // Single-line: byte-idêntico ao caminho de hoje.
      ({ oddByKey, impliedByKey } = deriveImplied(oddsBundle));
      // Bloco Poisson na linha 2.5 (v2 é 2.5-only); undefined pros mercados não-over/under.
      const singleBlock = scorelineModelForLines([2.5]);
      input = cartridge.buildPredictionInput({
        ...commonInputArgs,
        odds: {
          bookmaker: oddsBundle.bookmakerTitle,
          // captured_at normalizado aqui (mantém o local do new Date().toISOString()
          // do legado): o caminho fallback traz `lastUpdate` cru do provider
          // ("...Z"); o fresh já traz ISO. O cartucho consome verbatim.
          captured_at: new Date(oddsBundle.lastUpdate).toISOString(),
          selections: selectionKeys.map((key) => ({ key, odd: oddByKey[key] })),
        },
        implied: { pct: impliedByKey },
        ...(singleBlock ? { scorelineModel: singleBlock } : {}),
      });
    }
  } catch (err) {
    if (err instanceof cartridge.BuildInputError) {
      throw new PredictError(`buildPredictionInput failed: ${err.message}`, {
        ...(err as { context?: Record<string, unknown> }).context,
      });
    }
    throw err;
  }

  // 7. Monta a request da análise (provider-neutra; ADR 0027). O cartucho fornece
  //    system/tool/toolName; os genParams são MODEL-AWARE dentro do adapter
  //    (maxTokens p/ todos, effort só adaptive, temperature só temperature-mode).
  //    Leitura barata de DB ante a chamada paga ao LLM.
  const daysToKickoff = Math.max(
    0,
    Math.ceil((kickoffMs - Date.now()) / 86_400_000),
  );
  const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });
  const genParams = await getGenerationParams();
  const analysisRequest: AnalysisRequest = {
    model,
    system: cartridge.systemPrompt,
    userMessage,
    // cartridge.tool já é o ToolDef neutro (ADR 0027 #231) — passado direto, sem
    // reconstrução; cada adapter down-mapeia pro shape do seu SDK.
    tool: cartridge.tool,
    toolName: cartridge.toolName,
    maxTokens: genParams.maxTokens,
    effort: genParams.effort,
    temperature: genParams.temperature,
    deadlineAt,
  };

  // 8. Chamada paga via o seam AIProvider (o adapter é dono do SDK e do cronômetro
  //    TIGHT). predict não importa mais nenhum SDK de IA (fronteira CLAUDE.md).
  const aiProvider = getProviderForModel(model);
  // providerKey é gravado em ai_calls.provider (text, pós-migration #231). Validado
  // UMA vez contra o allowlist (isAIProvider) — o gate do de-hardcode: zero literal
  // de provider em predict; uma key fora do allowlist falha alto, não corrompe a auditoria.
  const providerKey = aiProvider.providerKey;
  if (!isAIProvider(providerKey)) {
    throw new PredictError(
      `unknown AI provider '${providerKey}' for model ${model.id}`,
      { provider: providerKey, model: model.id },
    );
  }
  // Backstop de inertness (ADR 0027 #231): a SELEÇÃO (modelsForAudience) já filtra
  // providers sem chave, mas o gate de override/preferência (isModelAllowedForAudience)
  // NÃO é key-gated — um override admin ou uma preferência stale pode resolver um
  // provider INERTE (ex.: OpenAI sem OPENAI_API_KEY). Falha aqui GRACIOSA e AUDITADA
  // (provider_error em ai_calls), zero gasto, em vez do throw cru de getXClient() no adapter.
  if (!aiProvider.hasKey()) {
    const noKeyMsg = `${providerKey} provider has no API key configured`;
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: analysisRequest as unknown as Record<string, unknown>,
      outputPayload: { error: noKeyMsg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: noKeyMsg,
      promptVersion: cartridge.version,
    });
    throw new PredictError(noKeyMsg, { provider: providerKey, model: model.id });
  }
  // Os fan-outs (best bet, multi-mercado) cobram o slot desta chamada paga logo ANTES
  // dela (#512, #524 review), depois de todas as falhas pré-gasto. Sem hook (a
  // análise avulsa, que cobra o slot na action) é o caminho de hoje.
  // Prazo do run (#524): não inicia uma chamada que o timeout vai cortar — pula sem
  // gasto e sem slot (o hook abaixo cobra o slot).
  if (
    !canFitCall(deadlineAt, {
      thinkingMode: model.thinkingMode,
      maxTokens: genParams.maxTokens,
      effort: genParams.effort,
    })
  ) {
    throw new AnalysisDeadlineError();
  }
  if (opts.beforeLlmPath) await opts.beforeLlmPath();
  const result = await aiProvider.runAnalysis(analysisRequest);
  const latencyMs = result.latencyMs;
  if (!result.ok) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs,
      status: result.status,
      errorMessage: result.message,
      promptVersion: cartridge.version,
    });
    // Recusa do modelo (#524): auditada acima como qualquer falha (tokens cobrados,
    // resposta crua no outputPayload), sem prediction. Mensagem própria pra a action
    // dizer "o modelo recusou a análise" em vez de "falha temporária".
    if (result.refusal) {
      throw new PredictError("model refused the analysis", {
        refusal: result.refusal,
        model: model.id,
        cause: result.cause,
      });
    }
    throw new PredictError(`anthropic call failed: ${result.message}`, {
      cause: result.cause,
    });
  }
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const inputPayload = result.inputPayload;
  const outputPayload = result.outputPayload;

  // 9. tool_missing é provider-neutro: o adapter devolve `toolInput === undefined`
  //    quando o modelo não chamou o tool (predict é dono da classificação +
  //    persistência; o snippet sai do outputPayload, byte-idêntico ao response.content).
  if (result.toolInput === undefined) {
    const snippet = JSON.stringify(
      (result.outputPayload as { content?: unknown }).content,
    ).slice(0, 500);
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "tool_missing",
      errorMessage: `model did not call ${cartridge.toolName}; content=${snippet}`,
      promptVersion: cartridge.version,
    });
    throw new PredictError("LLM did not call submit_prediction tool", {
      stopReason: result.stopReason,
    });
  }

  // 10. Validação Zod do output (schema do cartucho; fronteira do CLAUDE.md —
  //     output do LLM SEMPRE validado por Zod antes de uso).
  const parsed = cartridge.outputSchema.safeParse(result.toolInput);
  if (!parsed.success) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "invalid_output",
      errorMessage: JSON.stringify(parsed.error.issues),
      promptVersion: cartridge.version,
    });
    throw new PredictError("LLM output failed Zod validation", {
      issues: parsed.error.issues,
    });
  }
  // O registry apaga o genérico do schema (ZodType<unknown>). predict é
  // market-agnostic: lê só os campos compartilhados (recommendation/confidence_pct/
  // rationale/key_factors/minimum_odd) via BaseMarketOutput — cada cartucho já
  // validou o output completo pelo SEU schema acima. O comportamento específico de
  // mercado vem de cartridge.selectionProbs / descriptor, nunca de `if (market===X)`.
  const output = parsed.data as BaseMarketOutput;

  // 10b. Linha escolhida + marketParams (#175). Multi-linha: a linha vem do output
  //      via resolveParams (OBRIGATÓRIO — sem fallback a descriptor.params, que
  //      settlaria a linha errada); fixa o bundle/odds/implícita DAQUELA linha pra
  //      todo o downstream (edge/PSO/persist). Single-line / v2 (sem resolveParams):
  //      marketParams = descriptor.params (caminho de hoje, byte-idêntico).
  let marketParams: { line: number } | null;
  if (bundlesByLine) {
    if (!cartridge.resolveParams) {
      throw new PredictError(
        `multi-line cartridge '${marketKey}' sem resolveParams (linha escolhida indefinível)`,
        { marketKey },
      );
    }
    marketParams = cartridge.resolveParams(output);
    const chosen = bundlesByLine.get(marketParams.line);
    if (!chosen) {
      throw new PredictError(
        `LLM escolheu a linha ${marketParams.line} fora da escada resolvida`,
        {
          marketKey,
          line: marketParams.line,
          available: [...bundlesByLine.keys()],
        },
      );
    }
    oddsBundle = chosen;
    ({ oddByKey, impliedByKey } = deriveImplied(chosen));
  } else {
    marketParams = cartridge.descriptor.params ?? null;
  }
  // bookmaker persistido = título do book das odds analisadas. scorer não usa
  // `oddsBundle` (MarketOddsBundle de partição); vem do scorerBundle. Resolvido
  // num único lugar pra a persistência não tocar `oddsBundle` no caminho scorer.
  const bookmakerTitle = isIndependentBinary
    ? scorerBundle!.bookmakerTitle
    : oddsBundle.bookmakerTitle;

  // 11. Persistência (sequencial — neon-http não suporta transações reais).
  const cost = calculateCost({
    model: model.id,
    inputTokens,
    outputTokens,
  });
  let aiCallRow: typeof aiCalls.$inferSelect;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: cartridge.version,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning();
    aiCallRow = row;
  } catch (err) {
    // O erro real do Postgres mora em err.cause; Drizzle só expõe o wrapper
    // "Failed query:" em err.message. Sem isto, uma violação de FK/constraint
    // some no log como "unexpected". Ver lib/db/pg-error.ts.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        error: "ai_call_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist ai_call", cause);
  }

  // Probabilidade do modelo por seleção (decisão B): derivada PURA do output pelo
  // cartucho (binário em over/under, distribuição em 1X2). Alimenta a coluna NOVA
  // `model_prob_pct` do PSO, a grade N-vias retornada (seam 8) E o edge persistido
  // abaixo. Computada aqui (antes do edge) porque o edge usa a prob POR SELEÇÃO.
  const modelProbByKey = cartridge.selectionProbs(output);

  const decision = await decideRecommendation({
    cartridge,
    marketKey,
    catalog,
    selectionKeys,
    oddByKey,
    impliedByKey,
    modelProbByKey,
    recommendation: output.recommendation,
    confidencePct: output.confidence_pct,
  });

  const persisted = await persistPrediction({
    matchId,
    userId,
    aiCallId: aiCallRow.id,
    cartridge,
    catalog,
    selectionKeys,
    oddByKey,
    modelProbByKey,
    marketParams,
    decision,
    confidencePct: output.confidence_pct,
    rationale: output.rationale,
    keyFactors: output.key_factors,
    minimumOdd: output.minimum_odd,
    bookmaker: bookmakerTitle,
    modelVersion: model.id,
    promptVersion: cartridge.version,
    // `label` (nome do jogador) viaja só pro scorer (#290).
    labelByKey: isIndependentBinary
      ? Object.fromEntries(scorerBundle!.players.map((p) => [p.key, p.label]))
      : null,
  });
  return { kind: "done", result: persisted };
}

// ─── Decisão + persistência (compartilhadas pelos motores llm e code_jev) ────

type MarketCatalog = { marketId: string; idByKey: Map<string, string> };

type DecisionArgs = {
  cartridge: MarketCartridge;
  marketKey: string;
  catalog: MarketCatalog;
  selectionKeys: string[];
  oddByKey: Record<string, number>;
  impliedByKey: Record<string, number>;
  modelProbByKey: Record<string, number>;
  // selectionKey recomendada pelo motor (LLM ou código), ou "pass" — PRÉ-gate.
  recommendation: string;
  confidencePct: number;
};

type GatedDecision = {
  side: string;
  gatedToPass: boolean;
  oddAtRec: number | null;
  impliedPct: number | null;
  recModelProb: number | null;
  edge: number | null;
  stakeUnits: number;
  selectionId: string | null;
  psoRowsToInsert: {
    selectionId: string;
    odd: string;
    modelProbPct: string | null;
  }[];
};

// Edge N-vias + gate (ADR 0038, autoridade final pros DOIS motores) + staking +
// resolução de seleções. Hard-fails de seed acontecem aqui, ANTES do insert da
// prediction.
async function decideRecommendation(a: DecisionArgs): Promise<GatedDecision> {
  // Edge N-vias (ADR 0018): cada seleção tem seu próprio edge `modelProb − implied`.
  // NUNCA `100−x` — em N≥3 não há complemento binário. `pass` → sem lado, sem edge.
  // O lado recomendado é uma selectionKey (`oddByKey`/`impliedByKey` indexados por
  // ela); o valor é `undefined` só se a seleção não está no mercado — bug de
  // contrato, não fluxo (o catalog/seed guard já barrou antes).
  //
  // `modelProb` do lado recomendado vem de selectionProbs(output)[side] — a MESMA
  // prob por seleção que a grade exibe — não de confidence_pct. Em over/under são
  // byte-idênticos (selectionProbs[rec] === confidence_pct, ver over_under/index.ts);
  // em 1X2 o LLM pode emitir confidence_pct ≠ prob_<recomendado>, e aqui o edge
  // persistido passa a casar com o edge da grade N-vias em vez de divergir.
  // Edge do lado que o LLM recomendou (PRÉ-gate) — necessário pra DECIDIR o gate.
  const rawSide = a.recommendation;
  const rawImplied = rawSide === "pass" ? null : (a.impliedByKey[rawSide] ?? null);
  const rawModelProb =
    rawSide === "pass" ? null : (a.modelProbByKey[rawSide] ?? null);
  const rawEdge =
    rawSide !== "pass" && rawImplied !== null && rawModelProb !== null
      ? rawModelProb - rawImplied
      : null;
  const rawEdgeRounded = rawEdge === null ? null : Number(rawEdge.toFixed(2));

  // GATE DE EDGE (ADR 0038): recomendação com edge PERSISTIDO < piso do mercado →
  // rebaixa pra "pass" (a disciplina de MIN_EDGE_PP deixa de ser só compliance-de-
  // prompt e vira invariante de código). Reatribuir `side` ANTES das expressões
  // `side === "pass" ? null : …` produz uma row de pass GENUÍNA (selectionId/odd/
  // implícita/edge null, stake 1u) — sem row-quimera.
  // Piso resolvido igual à view (analysis.ts): descriptor.minEdgePp ?? MIN_EDGE_PP.
  const side = isBelowEdgeFloor(
    rawSide,
    rawEdgeRounded,
    a.cartridge.descriptor.minEdgePp ?? MIN_EDGE_PP,
  )
    ? "pass"
    : rawSide;
  // Rebaixado PELO gate (vs. pass genuíno do LLM). O rationale/keyFactors pró-lado do
  // LLM NÃO viajam pra o card (seriam prosa "gosto do over" sob a manchete "sem aposta"
  // — contradição visível E entraria como sinal pró-lado na síntese). Rationale neutro
  // no lugar; o output cru do LLM fica auditável em ai_calls.outputPayload (via aiCallId).
  const gatedToPass = side === "pass" && rawSide !== "pass";
  const oddAtRec = side === "pass" ? null : (a.oddByKey[side] ?? null);
  const impliedPct = side === "pass" ? null : (a.impliedByKey[side] ?? null);
  // `modelProbByKey[side]` é sempre finito em mercados partition (enum + refine
  // garantem a chave) — `?? null` é no-op lá (byte-idêntico). Em independent_binary
  // o schema scorer já exige a prob do recomendado, mas guardamos como defesa: um
  // cartucho free-form que omitisse a chave faria `undefined − impliedPct = NaN`
  // gravado em numeric + stake 1u silencioso. Aqui vira edge=null (nunca NaN).
  const recModelProb = side === "pass" ? null : (a.modelProbByKey[side] ?? null);
  const edge =
    side !== "pass" && impliedPct !== null && recModelProb !== null
      ? recModelProb - impliedPct
      : null;

  // Staking determinístico (ADR 0019): decidido EM CÓDIGO, nunca pelo LLM. A
  // banda usa os MESMOS valores CONGELADOS na row (edge/confiança arredondados a
  // 2 casas) pra que a decisão nunca divirja do `edge_pct` visível — no seam
  // 7.996→"8.00" a row mostra 8.00 e a banda decide sobre 8.00, não sobre o raw.
  // As colunas persistidas seguem byte-idênticas (toFixed(2) do raw == do
  // arredondado); só a DECISÃO passa a usar a precisão exata gravada.
  const edgePctRounded = edge === null ? null : Number(edge.toFixed(2));
  const confidencePctRounded = Number(a.confidencePct.toFixed(2));
  // Quarter-Kelly (ADR 0039 D3, #503) SÓ com o gate do Kelly pronto + kill-switch
  // ON (isKellyStakingActive, fail-closed, memo 1h). Fora disso — ou sem p/odd
  // mensuráveis — as bandas acima. Pass não consulta o gate (stake irrelevante).
  const kellyUnits =
    side !== "pass" &&
    recModelProb !== null &&
    oddAtRec !== null &&
    (await isKellyStakingActive())
      ? computeKellyStakeUnits(recModelProb / 100, oddAtRec)
      : null;
  const stakeUnits =
    kellyUnits ?? computeStakeUnits(edgePctRounded, confidencePctRounded);

  // Coluna NOVA `selection_id`: o lado escolhido (NULL em pass — não há seleção).
  // Resolvido em MEMÓRIA pelo catálogo já lido — hard-fail ANTES do insert (não
  // violação de FK opaca pós-paga) se a seleção recomendada não estiver seedada.
  let selectionId: string | null = null;
  if (side !== "pass") {
    const id = a.catalog.idByKey.get(side);
    if (!id) {
      throw new PredictError(
        `seleção '${side}' não seedada pro market '${a.cartridge.descriptor.dbMarketKey}'`,
        { marketKey: a.marketKey, recommendation: side },
      );
    }
    selectionId = id;
  }

  // Rows do candidate set (N seleções) pra prediction_selection_odds, montadas
  // ANTES do insert da prediction pra que um seed faltante falhe SEM ter
  // commitado a prediction (mesma semântica do hard-fail de selectionId acima).
  // odds = EXATAMENTE o par do MESMO bundle congelado. Uma row por seleção,
  // INCLUSIVE em pass. `model_prob_pct` vem do cartucho (numeric nullable;
  // toFixed(2) no boundary).
  const psoRowsToInsert = a.selectionKeys.map((key) => {
    const sid = a.catalog.idByKey.get(key);
    if (!sid) {
      throw new PredictError(
        `seleção '${key}' não seedada pro market '${a.cartridge.descriptor.dbMarketKey}'`,
        { marketKey: a.marketKey, key },
      );
    }
    const modelProb = a.modelProbByKey[key];
    return {
      selectionId: sid,
      odd: a.oddByKey[key].toFixed(3),
      modelProbPct: modelProb === undefined ? null : modelProb.toFixed(2),
    };
  });

  return {
    side,
    gatedToPass,
    oddAtRec,
    impliedPct,
    recModelProb,
    edge,
    stakeUnits,
    selectionId,
    psoRowsToInsert,
  };
}

type PersistArgs = {
  matchId: string;
  userId: string;
  aiCallId: string;
  cartridge: MarketCartridge;
  catalog: MarketCatalog;
  selectionKeys: string[];
  oddByKey: Record<string, number>;
  modelProbByKey: Record<string, number>;
  marketParams: { line: number } | null;
  decision: GatedDecision;
  confidencePct: number;
  rationale: string;
  keyFactors: string[];
  minimumOdd: number | undefined;
  bookmaker: string;
  modelVersion: string;
  promptVersion: string;
  judgments?: PredictionJudgments;
  labelByKey: Record<string, string> | null;
};

async function persistPrediction(a: PersistArgs): Promise<PredictResult> {
  const { side, gatedToPass, oddAtRec, impliedPct, edge, stakeUnits, selectionId } =
    a.decision;

  let predictionRow: Prediction;
  try {
    const [row] = await db
      .insert(predictions)
      .values({
        matchId: a.matchId,
        userId: a.userId,
        aiCallId: a.aiCallId,
        // Fonte-da-verdade mercado-agnóstica (#165): marketId do catálogo;
        // selectionId resolvido acima (NULL em pass); marketParams = a linha
        // ESCOLHIDA (#175): resolveParams(output) no multi-linha, descriptor.params
        // no single-line (= { line: 2.5 } NUMBER pro over/under v2; null pro 1X2).
        // Settlement lê daqui. O enum legado `market` saiu no contract (Fase 5).
        marketId: a.catalog.marketId,
        selectionId,
        marketParams: a.marketParams,
        // recommendation = a key da seleção escolhida (over/under/home/draw/away/
        // yes/no/dupla-chance) ou "pass". `side` = a recomendação JÁ GATEADA (ADR
        // 0038): igual a output.recommendation, exceto quando o gate rebaixou pra pass.
        recommendation: side,
        // confidence do LLM segue (é a estimativa do lado, consistente com pass genuíno).
        // Num pass REBAIXADO, rationale/keyFactors viram neutros (a prosa pró-lado do LLM
        // sob "sem aposta" seria contraditória no card E sinal pró-lado na síntese); o cru
        // fica em ai_calls.outputPayload. Pass genuíno e rec real seguem com o do LLM.
        confidencePct: a.confidencePct.toFixed(2),
        rationale: gatedToPass ? GATED_PASS_RATIONALE : a.rationale,
        keyFactors: gatedToPass ? [] : a.keyFactors,
        // minimum_odd só existe pra recomendação real; num pass (inclusive gateado)
        // é null — casa a row de pass genuína (o LLM omite minimum_odd em pass).
        minimumOdd: side === "pass" ? null : (a.minimumOdd?.toFixed(3) ?? null),
        oddAtRecommendation: oddAtRec?.toFixed(3) ?? null,
        // bookmaker = fonte das odds analisadas — persiste também em pass
        // (ADR 0012, decisão 3). scorer: do scorerBundle (ver bookmakerTitle).
        bookmaker: a.bookmaker,
        impliedProbPct: impliedPct?.toFixed(2) ?? null,
        edgePct: edge?.toFixed(2) ?? null,
        // Stake congelado (ADR 0019): banda determinística sobre edge/confiança;
        // pass → 1u (irrelevante, fora do Yield). numeric(6,2) → string.
        stakeUnits: stakeUnits.toFixed(2),
        modelVersion: a.modelVersion,
        promptVersion: a.promptVersion,
        // Só o motor code_jev grava (ADR 0041 §6); o caminho LLM não envia a chave.
        ...(a.judgments ? { judgments: a.judgments } : {}),
      })
      .returning();
    predictionRow = row;
  } catch (err) {
    // ai_call já foi persistido (custo registrado); só a prediction falhou.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId: a.matchId,
        userId: a.userId,
        aiCallId: a.aiCallId,
        error: "prediction_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist prediction", cause);
  }

  // 12. prediction_selection_odds (SEQUENCIAL, após prediction.id — o FK NOT NULL
  //     só existe após .returning()). As rows (candidate set, INCLUSIVE pass) já
  //     foram montadas acima; aqui só ligamos o predictionId e inserimos.
  //
  //     Falha AQUI (prediction já commitada) = log + DEGRADE (não throw): retorna
  //     a prediction; o candidate set é re-preenchível pelo backfill #162
  //     (idempotente via o UNIQUE). Janela de parcialidade tolerada (estilo
  //     persistAiCallError — não mascarar a prediction válida com um erro de PSO).
  try {
    await db.insert(predictionSelectionOdds).values(
      a.decision.psoRowsToInsert.map((r) => ({
        predictionId: predictionRow.id,
        selectionId: r.selectionId,
        odd: r.odd,
        modelProbPct: r.modelProbPct,
      })),
    );
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId: a.matchId,
        userId: a.userId,
        predictionId: predictionRow.id,
        error: "prediction_selection_odds_insert_failed",
        ...cause,
      }),
    );
    // Degrade: a prediction já está persistida; não derrubar o caller por uma
    // falha do candidate set (re-preenchível pelo backfill #162).
  }

  // Carrier da grade N-vias (gate #15): a prediction + o marketKey resolvido + uma
  // entrada por selectionKey (prob do modelo + odd congelada). A action monta a
  // view SÍNCRONA a partir disto. Tudo já em escopo (selectionKeys/modelProbByKey/
  // oddByKey) — nenhuma re-query. `label` (nome do jogador) viaja só pro scorer:
  // a view o prefere ao presentation.selectionLabel(key) (que devolveria a key crua).
  const labelByKey = a.labelByKey;
  return {
    prediction: predictionRow,
    marketKey: a.cartridge.marketKey,
    selections: a.selectionKeys.map((key) => ({
      key,
      modelProbPct: a.modelProbByKey[key],
      odd: a.oddByKey[key] ?? null,
      ...(labelByKey ? { label: labelByKey[key] } : {}),
    })),
  };
}

// ─── Motor code_jev (ADR 0041, #511) ─────────────────────────────────────────

type JudgmentRun = {
  answers: JudgmentAnswers | null;
  // Modelo pedido (pin) e o ecoado pela API; null quando o JEV não respondeu.
  jevModel: string | null;
  jevModelServed: string | null;
  failure: JudgmentFailure | null;
  stateHash: string;
  aiCallId: string | null;
  reusedFromPredictionId: string | null;
};

// Janela de reuso das respostas JEV entre mercados do mesmo jogo: o state (hash)
// já captura desfalques/tabela/descanso; a janela só limita o quão velho pode ser.
const JUDGMENT_REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;

// Julgamentos do jogo: reusa os de uma predição recente (mesmo jogo, mesmas
// versões de perguntas/pesos, mesmo state, aplicados, ≤6h) — sem chamada e sem
// row nova em ai_calls. Senão, UMA chamada JEV (fail-open: judgeMatch nunca lança)
// + a row de auditoria em ai_calls, sucesso OU falha (ADR 0041 §5: predict é a
// porta única e loga).
async function runJudgments(args: {
  userId: string;
  matchId: string;
  stateInput: JudgmentStateInput;
}): Promise<JudgmentRun> {
  const stateHash = judgmentStateHash(buildJudgmentState(args.stateInput));

  const reused = await findReusableJudgments({
    matchId: args.matchId,
    judgmentsVersion: JUDGMENTS_VERSION,
    weightsVersion: JUDGMENT_WEIGHTS_VERSION,
    // Respostas de outro modelo JEV (upgrade do pin) nunca são reusadas.
    jevModel: JUDGMENT_MODEL_ID,
    stateHash,
    since: new Date(Date.now() - JUDGMENT_REUSE_WINDOW_MS),
  }).catch((err: unknown) => {
    // Falha da busca = só perde o reuso; segue pra chamada JEV normal.
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId: args.matchId,
        error: "judgments_reuse_lookup_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  });
  if (reused) {
    const src = reused.judgments;
    return {
      answers: src.answers,
      jevModel: src.versions.jevModel,
      jevModelServed: src.versions.jevModelServed ?? null,
      failure: null,
      stateHash,
      aiCallId: src.aiCallId ?? null,
      // Aponta pra predição que CHAMOU o JEV (a origem), não pra um reuso de reuso.
      reusedFromPredictionId: src.reusedFromPredictionId ?? reused.predictionId,
    };
  }

  const captured: { failure: JudgmentFailure | null } = { failure: null };
  const result = await judgeMatch(
    createTypeSafeJudgmentProvider(),
    args.stateInput,
    {
      onFailure: (failure) => {
        captured.failure = failure;
      },
    },
  );
  const failure = result ? null : captured.failure;
  let aiCallId: string | null = null;
  if (result) {
    aiCallId = await persistJudgmentAiCall({
      userId: args.userId,
      matchId: args.matchId,
      model: result.model,
      promptVersion: JUDGMENTS_VERSION,
      inputPayload: result.requestPayload,
      outputPayload: result.responsePayload,
      inputTokens: result.inputTokens,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      status: "ok",
      errorMessage: null,
    });
  } else if (failure) {
    aiCallId = await persistJudgmentAiCall({
      userId: args.userId,
      matchId: args.matchId,
      model: JUDGMENT_MODEL_ID,
      promptVersion: JUDGMENTS_VERSION,
      inputPayload: failure.requestPayload ?? {},
      outputPayload: {
        error: failure.message,
        kind: failure.kind,
        responseBody: failure.responseBody ?? null,
      },
      inputTokens: failure.inputTokens ?? 0,
      latencyMs: failure.latencyMs,
      costUsd: failure.costUsd ?? 0,
      status:
        failure.kind === "missing_key" || failure.kind === "unexpected"
          ? "provider_error"
          : typeSafeErrorToAiCallStatus(failure.kind),
      errorMessage: `${failure.kind}: ${failure.message}`,
    });
  }
  return {
    answers: result?.answers ?? null,
    jevModel: result ? JUDGMENT_MODEL_ID : null,
    jevModelServed: result?.model ?? null,
    failure,
    stateHash,
    aiCallId,
    reusedFromPredictionId: null,
  };
}

// Input do state JEV + julgamentos do jogo. O reuso entre análises (runJudgments) é
// chaveado pelo stateHash, que depende da escalação anterior (papel do desfalque)
// — por isso a busca vem antes do lookup. Dentro de um best bet, o memo do run
// (CodeJevRunMemo) evita as duas.
async function resolveMatchJudgments(args: {
  userId: string;
  matchId: string;
  provider: SportsDataProvider;
  data: Omit<MatchJudgmentData, "previousLineups">;
}): Promise<{ input: MatchJudgmentInput; run: JudgmentRun }> {
  const { data } = args;
  const input = buildMatchJudgmentInput({
    ...data,
    previousLineups: await fetchPreviousLineups({
      provider: args.provider,
      kickoffAt: data.kickoffAt,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      homeForm: data.homeForm,
      awayForm: data.awayForm,
      injuries: data.injuries,
    }),
  });
  const run = await runJudgments({
    userId: args.userId,
    matchId: args.matchId,
    stateInput: input.stateInput,
  });
  return { input, run };
}

// Escalação do ÚLTIMO jogo de cada time (o da forma, antes deste) pra derivar o
// papel dos desfalques: a escalação DESTE jogo nunca traz quem está fora. Só busca
// pro time que tem desfalque (zero custo sem desfalques); uma chamada getLineups
// por time, cacheada no adapter. Falha/ausência → undefined e o input cai na
// escalação deste jogo (o comportamento anterior).
async function fetchPreviousLineups(args: {
  provider: SportsDataProvider;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  injuries: { home: NormalizedInjury[]; away: NormalizedInjury[] };
}): Promise<{ home?: NormalizedTeamLineup; away?: NormalizedTeamLineup }> {
  const kickoffMs = args.kickoffAt.getTime();
  const forTeam = async (
    team: string,
    form: readonly NormalizedFixture[],
    injuries: readonly NormalizedInjury[],
  ): Promise<NormalizedTeamLineup | undefined> => {
    if (injuries.length === 0) return undefined;
    const prev = previousFixture(form, kickoffMs);
    if (!prev) return undefined;
    try {
      const lineup = await args.provider.getLineups({
        league: prev.league,
        kickoffAt: prev.kickoffAt,
        homeTeam: prev.homeTeam,
        awayTeam: prev.awayTeam,
      });
      if (prev.homeTeam === team) return lineup?.home;
      if (prev.awayTeam === team) return lineup?.away;
      return undefined;
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "predict",
          error: "previous_lineup_fetch_failed",
          team,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return undefined;
    }
  };
  const [home, away] = await Promise.all([
    forTeam(args.homeTeam, args.homeForm, args.injuries.home),
    forTeam(args.awayTeam, args.awayForm, args.injuries.away),
  ]);
  return { home, away };
}

function codeJevModelVersion(modelId: AIModelId, scoreline: ModelScoreline) {
  return `${modelId};engine=code_jev;lambda=${scoreline.source};judg=${JUDGMENTS_VERSION};w=${JUDGMENT_WEIGHTS_VERSION}`;
}

function toPredictionJudgments(
  scoreline: ModelScoreline,
  engine: CodeJevDecision,
  jev: JudgmentRun,
): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: engine.judgments.applied,
    answers: jev.answers,
    multipliers: engine.judgments.multipliers,
    lambda: {
      source: scoreline.source,
      degraded: scoreline.degraded,
      rho: scoreline.rho ?? null,
      base: engine.lambdaBase,
      adjusted: {
        home: engine.judgments.lambdaHome,
        away: engine.judgments.lambdaAway,
      },
    },
    versions: {
      judgments: JUDGMENTS_VERSION,
      weights: JUDGMENT_WEIGHTS_VERSION,
      narrator: narratorCartridge.version,
      jevModel: jev.jevModel,
      jevModelServed: jev.jevModelServed,
    },
    failure: jev.failure
      ? { kind: jev.failure.kind, message: jev.failure.message }
      : null,
    stateHash: jev.stateHash,
    aiCallId: jev.aiCallId,
    reusedFromPredictionId: jev.reusedFromPredictionId,
  };
}

// A decisão JÁ GATEADA em forma de input do narrador. Foco = o lado recomendado;
// num pass, a melhor candidata do motor (o "por que não há valor").
function toNarratorDecision(args: {
  marketKey: string;
  selectionKeys: readonly string[];
  teams: { home: string; away: string };
  engine: CodeJevDecision;
  answers: JudgmentAnswers | null;
  decision: GatedDecision;
  line: number | null;
  oddByKey: Record<string, number>;
  minEdgePp: number;
}): NarratorDecision {
  const { engine, decision, teams, line } = args;
  const label = (key: string) =>
    selectionLabel(args.marketKey, key, teams, line);
  let focus: NarratorDecision["focus"] = null;
  if (decision.side !== "pass" && decision.recModelProb !== null) {
    focus = {
      key: decision.side,
      label: label(decision.side),
      modelProbPct: decision.recModelProb,
      impliedPct: decision.impliedPct,
      edgePct: decision.edge === null ? null : Number(decision.edge.toFixed(2)),
      odd: decision.oddAtRec,
    };
  } else if (engine.best) {
    focus = {
      key: engine.best.key,
      label: label(engine.best.key),
      modelProbPct: engine.best.modelProbPct,
      impliedPct: engine.best.impliedPct,
      edgePct: engine.best.edgePct,
      odd: args.oddByKey[engine.best.key] ?? null,
    };
  }
  return {
    marketKey: args.marketKey,
    marketLabel: getMarketPresentation(args.marketKey).marketLabel,
    line,
    teams,
    selectionKeys: args.selectionKeys,
    side: decision.side,
    focus,
    stakeUnits: decision.side === "pass" ? null : decision.stakeUnits,
    minEdgePp: args.minEdgePp,
    expectedGoals: {
      home: engine.judgments.lambdaHome,
      away: engine.judgments.lambdaAway,
    },
    judgmentsApplied: engine.judgments.applied,
    judgmentFactors: judgmentFactorPhrases(
      args.answers,
      engine.judgments.multipliers,
      teams,
    ),
  };
}

type NarrationOutcome = {
  status: AiCallStatus;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorMessage: string | null;
  output: NarratorOutput | null;
};

// Uma chamada narradora (ADR 0041 §4) pelo MESMO seam AIProvider, mesmo modelo
// resolvido e mesmos genParams. NUNCA bloqueia a análise: sem chave, erro de
// provider, tool ausente, Zod ou fidelidade → racional templado. A row de ai_calls
// (qualquer status) é a que a prediction referencia.
async function narrateDecision(args: {
  model: AIModel;
  userId: string;
  matchId: string;
  decision: NarratorDecision;
  context: NarratorContext;
  deadlineAt?: number;
  beforeLlmPath?: () => Promise<void>;
}): Promise<{ aiCallId: string; output: NarratorOutput }> {
  const { model, decision } = args;
  const genParams = await getGenerationParams();
  const request: AnalysisRequest = {
    model,
    system: narratorCartridge.systemPrompt,
    userMessage: narratorCartridge.buildUserMessage(decision, args.context),
    tool: narratorCartridge.tool,
    toolName: narratorCartridge.toolName,
    maxTokens: genParams.maxTokens,
    effort: genParams.effort,
    temperature: genParams.temperature,
    deadlineAt: args.deadlineAt,
  };
  const aiProvider = getProviderForModel(model);
  const providerKey = aiProvider.providerKey;
  if (!isAIProvider(providerKey)) {
    throw new PredictError(
      `unknown AI provider '${providerKey}' for model ${model.id}`,
      { provider: providerKey, model: model.id },
    );
  }

  // Prazo (#524): não inicia uma narração que o timeout vai cortar — lança antes do
  // gasto e do slot (o hook cobra o slot logo antes da chamada).
  if (
    !canFitCall(args.deadlineAt, {
      thinkingMode: model.thinkingMode,
      maxTokens: genParams.maxTokens,
      effort: genParams.effort,
    })
  ) {
    throw new AnalysisDeadlineError();
  }
  if (args.beforeLlmPath) await args.beforeLlmPath();
  const outcome = await runNarration(aiProvider, request, decision);
  const cost = calculateCost({
    model: model.id,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  });
  let aiCallId: string;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: args.userId,
        matchId: args.matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: narratorCartridge.version,
        inputPayload: outcome.inputPayload,
        outputPayload: outcome.outputPayload,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        latencyMs: outcome.latencyMs,
        costUsd: cost.toFixed(6),
        status: outcome.status,
        errorMessage:
          outcome.errorMessage === null
            ? null
            : truncate(outcome.errorMessage, 2000),
      })
      .returning();
    aiCallId = row.id;
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId: args.matchId,
        userId: args.userId,
        error: "ai_call_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist ai_call", cause);
  }
  return {
    aiCallId,
    output: outcome.output ?? narratorCartridge.fallback(decision),
  };
}

async function runNarration(
  aiProvider: ReturnType<typeof getProviderForModel>,
  request: AnalysisRequest,
  decision: NarratorDecision,
): Promise<NarrationOutcome> {
  const failed = (
    status: AiCallStatus,
    errorMessage: string,
    base: Partial<NarrationOutcome> = {},
  ): NarrationOutcome => ({
    status,
    inputPayload:
      base.inputPayload ?? (request as unknown as Record<string, unknown>),
    outputPayload: base.outputPayload ?? { error: errorMessage },
    inputTokens: base.inputTokens ?? 0,
    outputTokens: base.outputTokens ?? 0,
    latencyMs: base.latencyMs ?? 0,
    errorMessage,
    output: null,
  });

  if (!aiProvider.hasKey()) {
    return failed(
      "provider_error",
      `${aiProvider.providerKey} provider has no API key configured`,
    );
  }
  let result: Awaited<ReturnType<typeof aiProvider.runAnalysis>>;
  try {
    result = await aiProvider.runAnalysis(request);
  } catch (err) {
    return failed(
      "provider_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  const base = {
    inputPayload: result.inputPayload,
    outputPayload: result.outputPayload,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) return failed(result.status, result.message, base);
  if (result.toolInput === undefined) {
    return failed(
      "tool_missing",
      `model did not call ${narratorCartridge.toolName}`,
      base,
    );
  }
  const parsed = narratorCartridge.outputSchema.safeParse(result.toolInput);
  if (!parsed.success) {
    return failed("invalid_output", JSON.stringify(parsed.error.issues), base);
  }
  const fidelity = narratorCartridge.checkFidelity(parsed.data, decision);
  if (!fidelity.ok) {
    return failed("invalid_output", `fidelity: ${fidelity.reason}`, base);
  }
  return { ...base, status: "ok", errorMessage: null, output: parsed.data };
}
