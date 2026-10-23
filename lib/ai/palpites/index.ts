import { eq } from "drizzle-orm";

import { aiCalls, matches, palpiteSets, palpites } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import { getLatestMatchModelSnapshot } from "@/lib/db/queries/match-model-snapshots";
import type { DbPalpiteSet } from "@/lib/db/queries/palpites";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import { getNewsProvider } from "@/lib/providers/news";
import { analysesDetail, newsDetail, synthesisDetail } from "@/lib/ai/progress/details";
import {
  noteStep,
  progressTrace,
  stepDetail,
  trackStep,
} from "@/lib/ai/progress/run-progress";
import { STEP_NOTES, STEPS, synthesisStep } from "@/lib/ai/progress/steps";
import type {
  NewsFetchOutcome,
  NewsResult,
} from "@/lib/providers/news/types";
import {
  getGenerationParams,
  getEnableFidelityValidation,
} from "@/lib/db/queries/ai-config";

import { persistAiCallError } from "../ai-call-logging";
import { calculateCost } from "../cost";
import {
  AnalysisDeadlineError,
  NEWS_MIN_BUDGET_MS,
  SYNTHESIS_CALL_RESERVE_MS,
  canFitCall,
  remainingMs,
} from "../deadline";
import { liveColumns, liveStampFromState } from "@/lib/live/stamp";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import type { ZodType } from "zod";

import {
  MODEL_REGISTRY,
  UTILITY_EFFORT,
  UTILITY_MODEL_ID,
  isAIProvider,
  type AIModel,
  type AIModelId,
} from "../models";
import { getProviderForModel } from "../providers";
import type { AnalysisRequest, ToolDef } from "../providers/types";
import {
  palpitesLiveCartridge,
  type PalpiteLiveOutput,
} from "./cartridges/live";
import {
  liveConfidenceProbs,
  palpiteConfidence,
  pregameConfidenceProbs,
  type ConfidenceProbs,
} from "./confidence";
import { checkFidelity, type FidelityCheck } from "./fidelity-validator";
import { getPalpiteCartridge } from "./registry";
import {
  buildLivePalpiteRows,
  buildSettleablePalpiteRows,
} from "./settleable-rows";
import { containsValueLanguage } from "./value-language-guard";
import {
  PalpiteError,
  type GenerateLivePalpiteArgs,
  type GeneratePalpiteArgs,
  type PalpiteGenerationResult,
} from "./types";

export { PalpiteError } from "./types";
export type {
  GenerateLivePalpiteArgs,
  GeneratePalpiteArgs,
  PalpiteGenerationResult,
} from "./types";

const FORM_LAST = 5;
const H2H_LAST = 5;

// #380 — quantas SÍNTESES PAGAS no máximo por geração quando a validação de fidelidade
// está ON. DEFAULT = 1: na divergência, DEGRADA IMEDIATAMENTE (palpite:null) sem pagar
// uma 2ª chamada. Racional: uma contagem errada na MESMA request é sistemática,
// não ruído de amostragem → re-rodar raramente recupera; descartar o palpite é a escolha
// honesta e custo-neutra (alinha com prefer-skip-over-silent-wrong). Subir pra 2 (uma
// regeneração) é um flip trivial de preferência do dono — e valeria um nudge de prompt
// corretivo na retry pra a regen valer o custo (non-goal de v1).
const MAX_FIDELITY_ATTEMPTS = 1;

// Piso do max_tokens da manchete (o thinking do Haiku 5.5 conta dentro dele).
const SYNTHESIS_MIN_MAX_TOKENS = 8192;

/**
 * Busca de notícias da síntese (ADR 0032 / #377): provider DEDICADO via web search da
 * Claude. Degrada GRACIOSO (mirror absences): QUALQUER falha → results:[] e o palpite
 * ainda embarca — NUNCA bloqueia a manchete por notícia, e a promise nunca rejeita (o
 * caller pode dispará-la cedo e só aguardar depois). O provider já loga seu próprio
 * ai_call (predict.ts é a única porta).
 *
 * Prazo: a busca termina SYNTHESIS_CALL_RESERVE_MS antes do prazo do run, pra nunca
 * comer o tempo da manchete (que é o produto; notícia é cor). Sem tempo pra uma busca
 * útil, nem chama: o palpite sai sem fontes em vez de não sair.
 *
 * Depende só do jogo (não das análises), então o analyzeBestBet a dispara junto do
 * fan-out e a síntese não espera mais por ela no fim do run.
 */
export function startNewsFetch(
  match: { league: string; homeTeam: string; awayTeam: string; kickoffAt: Date },
  audit: { userId: string; matchId: string },
  deadlineAt: number | undefined,
): Promise<NewsFetchOutcome> {
  const newsDeadline =
    deadlineAt === undefined ? undefined : deadlineAt - SYNTHESIS_CALL_RESERVE_MS;
  const newsFits =
    newsDeadline === undefined || remainingMs(newsDeadline) >= NEWS_MIN_BUDGET_MS;
  if (!newsFits) {
    noteStep(STEPS.news, "skipped");
    return Promise.resolve({ results: [], aiCall: null, unavailable: true });
  }
  return trackStep(
    STEPS.news,
    () => fetchNews(match, audit, newsDeadline),
    (outcome) =>
      outcome.unavailable
        ? { status: "failed" }
        : outcome.results.length === 0
          ? { status: "done", label: STEP_NOTES.newsEmpty }
          : { detail: newsDetail(outcome.results.length) },
  );
}

function fetchNews(
  match: Parameters<typeof startNewsFetch>[0],
  audit: Parameters<typeof startNewsFetch>[1],
  newsDeadline: number | undefined,
): Promise<NewsFetchOutcome> {
  return getNewsProvider()
    .getNewsByMatch(
      {
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt.toISOString(),
      },
      audit,
      { deadlineAt: newsDeadline },
    )
    .catch((err: unknown): NewsFetchOutcome => {
      console.error(
        JSON.stringify({
          scope: "generatePalpites",
          matchId: audit.matchId,
          error: "news_fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return { results: [] as NewsResult[], aiCall: null, unavailable: true };
    });
}

/**
 * Passo de SÍNTESE do palpite-first (ADR 0030 / #353): turna as N análises
 * multi-mercado já pagas pelo fan-out (`analyses`) numa única MANCHETE — veredito de
 * quem ganha + placar provável + confiança qualitativa + narrativa + mercados citados.
 * IRMÃO de `predict()` (NÃO o chama): reusa SÓ (a) o seam de provider (ADR 0027, p/
 * logar ai_calls) e (b) o padrão de logging. ZERO import de SDK de IA.
 *
 * FIREWALL (ADR 0030 §3): a síntese é ALIMENTADA com edge/EV/odd via `analyses`
 * (DADO) — mas a manchete (output) carrega ZERO número de valor. Três pernas: (a)
 * output Zod `.strict()` sem campo de valor; (b) `containsValueLanguage` pós-Zod;
 * (c) o `PalpiteHeadlineView` sem campo de valor (na camada de view).
 *
 * Default Haiku (econômico, UTILITY_MODEL_ID). Fetch de suporte ENXUTO (form/h2h/
 * standings) como cor narrativa — crucial no caso all-pass (veredito apoia na forma).
 */
export async function generatePalpites({
  matchId,
  userId,
  analyses,
  modelOverride,
  deadlineAt,
  news,
}: GeneratePalpiteArgs): Promise<PalpiteGenerationResult> {
  // 1. Modelo: SEM cascata de preferência (palpite é universal). Fixo no registry.
  const resolvedModelId: AIModelId = modelOverride ?? UTILITY_MODEL_ID;
  const model = MODEL_REGISTRY[resolvedModelId];

  // 2. Lookup do match. Backstop de analisabilidade da SÍNTESE — só barra estados
  //    TERMINAIS (finished/cancelled → throw). NÃO espelha o gate de pré-jogo do
  //    predict (#385: scheduled E kickoff no futuro): a síntese roda DEPOIS das
  //    análises (que já passaram pelo gate endurecido em predict.ts + o
  //    capabilityGateMessage da action), então re-rejeitar por kickoff aqui
  //    descartaria o palpite de um jogo que apitou DURANTE uma análise longa.
  //    Defense-in-depth: o único caller (analyzeBestBet) já está a jusante do gate
  //    da action E de cada predict() — este throw é a última rede contra um set de
  //    jogo já encerrado/cancelado.
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PalpiteError("match not found", { matchId });
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new PalpiteError("match is not analyzable", {
      matchId,
      status: match.status,
    });
  }
  const kickoffMs = match.kickoffAt.getTime();

  // 3. Cartucho (sem extraLines/marketKey).
  const cartridge = getPalpiteCartridge();

  // 4. Fetch de dados de suporte — ENXUTO: form/h2h/standings via a SportsDataProvider
  //    (mantido como COR NARRATIVA, crucial no caso all-pass; cache do fan-out já
  //    aqueceu → latência marginal). SEM absences/lineups. `fixture` (venue + nomes)
  //    ainda é útil e barato.
  const provider = getSportsDataProvider();
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  // Notícias (ADR 0032 / #377): a busca que o caller já disparou junto do fan-out, ou
  // uma agora, em paralelo ao fetch de suporte. Nunca rejeita (ver startNewsFetch).
  const newsFetch =
    news ??
    startNewsFetch(
      {
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt,
      },
      { userId, matchId },
      deadlineAt,
    );

  const [fixture, homeForm, awayForm, h2h, standings, newsOutcome, snapshot] =
    await Promise.all([
      provider.getFixtureByMatch(ref),
      provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
      provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
      provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
      provider.getStandings(match.league),
      newsFetch,
      // Fonte da confiança do palpite (#649). Falha de leitura não derruba a síntese:
      // cai na análise de 1X2 do code_jev ou fica sem chip.
      getLatestMatchModelSnapshot(matchId).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            scope: "generatePalpites",
            matchId,
            error: "snapshot_read_failed",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return null;
      }),
    ]);

  // 5. Monta input (com as análises) + 6. userMessage.
  const input = cartridge.buildPredictionInput({
    match: {
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
    },
    fixture,
    homeForm,
    awayForm,
    h2h,
    standings,
    analyses,
    // ADR 0032 / #377 — notícias factuais reais como insumo da síntese.
    news: newsOutcome.results,
  });
  const daysToKickoff = Math.max(
    0,
    Math.ceil((kickoffMs - Date.now()) / 86_400_000),
  );
  const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });

  return runSynthesis({
    userId,
    matchId,
    model,
    cartridge,
    userMessage,
    deadlineAt,
    rowsFor: (output) => buildSettleablePalpiteRows("", output),
    fidelity: (output) => checkFidelity(output, input),
    sourcePredictionIds: analyses.map((a) => a.predictionId),
    sources: newsOutcome.results,
    live: null,
    analysesLines: analysesDetail(analyses),
    confidenceProbs: pregameConfidenceProbs(snapshot, analyses),
  });
}

// ─── Síntese → manchete persistida (pré-jogo e ao vivo) ──────────────────────

type SynthesisCartridge<O> = {
  version: string;
  systemPrompt: string;
  tool: ToolDef;
  toolName: string;
  outputSchema: ZodType<O>;
};

type SynthesisOutputBase = {
  verdict: string;
  probableScore: { home: number; away: number };
  narrative: string;
  citedMarkets: string[];
};

type SynthesisSpec<O extends SynthesisOutputBase> = {
  userId: string;
  matchId: string;
  model: AIModel;
  cartridge: SynthesisCartridge<O>;
  userMessage: string;
  deadlineAt?: number;
  // As linhas settleable (templates fixos) da saída.
  rowsFor: (output: O) => ReturnType<typeof buildSettleablePalpiteRows>;
  fidelity: (output: O) => FidelityCheck;
  sourcePredictionIds: string[];
  sources: NewsResult[];
  live: ReturnType<typeof liveColumns> | null;
  // O que cada análise escolheu, pro "Ver raciocínio" (ADR 0065).
  analysesLines: string[];
  // P(1X2) do motor pra confiança do palpite (#649); null = sem fonte, sem chip.
  confidenceProbs: ConfidenceProbs | null;
};

/**
 * O loop de síntese (#380) + a persistência (ai_call → palpite_set → palpites), comum ao
 * palpite de pré-jogo e ao ao vivo. O firewall (Zod `.strict()` + guard de conteúdo) roda
 * em todo candidato; a fidelidade depois dele.
 */
async function runSynthesis<O extends SynthesisOutputBase>(
  spec: SynthesisSpec<O>,
): Promise<PalpiteGenerationResult> {
  const { userId, matchId, model, cartridge, userMessage, deadlineAt } = spec;
  // 7. AnalysisRequest. effort FIXO e baixo (UTILITY_EFFORT), não o do ai_config: a
  //    manchete preenche um tool a partir de análises já prontas e roda no fim do run,
  //    na reserva da síntese. maxTokens de getGenerationParams, com piso de 8192: o
  //    thinking conta dentro dele, e um max_tokens baixo do admin cortaria a tool call.
  const genParams = await getGenerationParams();
  const analysisRequest: AnalysisRequest = {
    model,
    system: cartridge.systemPrompt,
    userMessage,
    tool: cartridge.tool,
    toolName: cartridge.toolName,
    maxTokens: Math.max(genParams.maxTokens, SYNTHESIS_MIN_MAX_TOKENS),
    effort: UTILITY_EFFORT,
    deadlineAt,
  };

  // 8. Provider via o seam (ADR 0027). Sem chave → provider_error auditado + throw,
  //    zero gasto.
  const aiProvider = getProviderForModel(model);
  const providerKey = aiProvider.providerKey;
  if (!isAIProvider(providerKey)) {
    throw new PalpiteError(
      `unknown AI provider '${providerKey}' for model ${model.id}`,
      { provider: providerKey, model: model.id },
    );
  }
  if (!aiProvider.hasKey()) {
    const noKeyMsg = `${providerKey} provider has no API key configured`;
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model,
      inputPayload: analysisRequest as unknown as Record<string, unknown>,
      outputPayload: { error: noKeyMsg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: noKeyMsg,
      promptVersion: cartridge.version,
    });
    throw new PalpiteError(noKeyMsg, { provider: providerKey, model: model.id });
  }

  // 8b. Flag de validação de fidelidade (#380). Lida UMA VEZ antes do loop — default ON
  //     (?? true): em DB fresco/vazio (testes, primeiro deploy) também valida por padrão.
  //     OFF → caminho de hoje, byte-idêntico, ZERO custo extra (sem checkFidelity, sem regen).
  const validateFidelity = await getEnableFidelityValidation();

  // 8c–11b. LOOP BOUNDED de síntese (#380). O firewall (3 pernas, ADR 0030 §3) fica DENTRO
  //   do loop: qualquer candidato (inclusive uma regeneração) RE-LIMPA todas as pernas antes
  //   de poder ser aceito ou sequer fidelity-checado. O validador de fidelidade roda DEPOIS
  //   do firewall e só pode ADICIONAR uma rejeição (regen/degrade), nunca burlar/enfraquecer
  //   o guard. Sai APENAS por `break` (aceite) ou `throw` (degrade/erro terminal) — sem
  //   recursão. Com MAX_FIDELITY_ATTEMPTS=1, divergência → degrada na hora (sem 2ª paga).
  let output: O;
  let settleableRows: ReturnType<typeof buildSettleablePalpiteRows>;
  let latencyMs: number;
  let inputTokens: number;
  let outputTokens: number;
  let inputPayload: Record<string, unknown>;
  let outputPayload: Record<string, unknown>;
  // O modelo que respondeu a tentativa aceita (auditoria, custo e modelVersion).
  let servedModel: AIModel;

  for (let attempt = 1; ; attempt += 1) {
    // Prazo do run (#524): sem tempo pra uma chamada inteira, não chama — nada gasto e
    // nenhuma row 0/0 de timeout falso em ai_calls. O caller trata como síntese falha.
    if (
      !canFitCall(deadlineAt, {
        speed: model.speed,
        maxTokens: analysisRequest.maxTokens,
        effort: analysisRequest.effort,
      })
    ) {
      throw new AnalysisDeadlineError();
    }
    const result = await aiProvider.runAnalysis(analysisRequest);
    latencyMs = result.latencyMs;
    servedModel = result.servedModel;

    // 9. Erro do provider.
    if (!result.ok) {
      await persistAiCallError({
        userId,
        matchId,
        provider: providerKey,
        model: servedModel,
        inputPayload: result.inputPayload,
        outputPayload: result.outputPayload,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs,
        status: result.status,
        errorMessage: result.message,
        promptVersion: cartridge.version,
      });
      throw new PalpiteError(`palpite generation failed: ${result.message}`, {
        cause: result.cause,
      });
    }
    inputTokens = result.usage.inputTokens;
    outputTokens = result.usage.outputTokens;
    inputPayload = result.inputPayload;
    outputPayload = result.outputPayload;

    // 10. tool_missing.
    if (result.toolInput === undefined) {
      const snippet = JSON.stringify(
        (result.outputPayload as { content?: unknown }).content,
      ).slice(0, 500);
      await persistAiCallError({
        userId,
        matchId,
        provider: providerKey,
        model: servedModel,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        status: "tool_missing",
        errorMessage: `model did not call ${cartridge.toolName}; content=${snippet}`,
        promptVersion: cartridge.version,
      });
      throw new PalpiteError(`LLM did not call ${cartridge.toolName} tool`, {
        stopReason: result.stopReason,
      });
    }

    // 11. Validação Zod (fronteira do CLAUDE.md).
    const parsed = cartridge.outputSchema.safeParse(result.toolInput);
    if (!parsed.success) {
      await persistAiCallError({
        userId,
        matchId,
        provider: providerKey,
        model: servedModel,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        status: "invalid_output",
        errorMessage: JSON.stringify(parsed.error.issues),
        promptVersion: cartridge.version,
      });
      throw new PalpiteError("LLM output failed Zod validation", {
        issues: parsed.error.issues,
      });
    }
    // Já tipado pelo schema concreto do cartucho (diferente de predict, que apaga
    // para BaseMarketOutput).
    const candidate: O = parsed.data;

    // 11b. FIREWALL leg (b) — guard de CONTEÚDO pós-Zod (ADR 0030 §3, blocker #5). O
    //      `.strict()` só barra chaves; o LLM pode ecoar um TERMO de valor numa string.
    //      Rodamos sobre TODO campo que cruza pra manchete/view: verdict + narrative +
    //      o `text` derivado de CADA linha settleable (templates fixos, #354) + os
    //      rótulos de citedMarkets (LLM-livre, vão verbatim pro PalpiteHeadlineView). Hit
    //      → tratado como `invalid_output` (mesmo path auditado do Zod) → throw → degrada
    //      pra palpite:null no try/catch do analyzeBestBet. REJEITAR > VAZAR. As rows são
    //      construídas AQUI (puras, sem DB) e reusadas no insert em batch (12c).
    const candidateRows = spec.rowsFor(candidate);
    const valueLeak =
      containsValueLanguage(candidate.verdict) ||
      containsValueLanguage(candidate.narrative) ||
      candidateRows.some((r) => containsValueLanguage(r.text)) ||
      candidate.citedMarkets.some(containsValueLanguage);
    if (valueLeak) {
      await persistAiCallError({
        userId,
        matchId,
        provider: providerKey,
        model: servedModel,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        status: "invalid_output",
        errorMessage:
          "manchete contém linguagem de valor (firewall ADR 0030 §3)",
        promptVersion: cartridge.version,
      });
      throw new PalpiteError("palpite headline leaked value language", {
        matchId,
      });
    }

    // 11c. VALIDAÇÃO DE FIDELIDADE (#380) — pós-firewall, pré-persist. Flag-OFF → aceita o
    //      primeiro candidato firewall-limpo (caminho de hoje, sem checkFidelity, custo zero).
    //      Flag-ON → checkFidelity (PURO, determinístico, NUNCA lança): se as contagens
    //      citadas na manchete batem com os fatos pré-contados do #379, aceita; em
    //      CONTRADIÇÃO, loga uma row de auditoria `fidelity_divergence` em ai_calls (sinal de
    //      frequência pra a kill-switch — NÃO uma chamada nova de LLM) + console.warn, e então
    //      DEGRADA (MAX=1: throw → palpite:null no try/catch do analyzeBestBet) ou regenera
    //      (MAX>1: re-síntese paga, re-limpa o firewall acima na próxima iteração).
    if (!validateFidelity) {
      output = candidate;
      settleableRows = candidateRows;
      break;
    }
    const fidelity = spec.fidelity(candidate);
    if (fidelity.ok) {
      noteStep(STEPS.check);
      output = candidate;
      settleableRows = candidateRows;
      break;
    }
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: servedModel,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "fidelity_divergence",
      errorMessage: `validação de fidelidade falhou (#380): ${fidelity.reason}`,
      promptVersion: cartridge.version,
    });
    console.warn(
      JSON.stringify({
        scope: "generatePalpites",
        matchId,
        attempt,
        warning: "fidelity_divergence",
        reason: fidelity.reason,
      }),
    );
    if (attempt >= MAX_FIDELITY_ATTEMPTS) {
      throw new PalpiteError(
        "fidelity validation failed after bounded retries",
        { matchId, reason: fidelity.reason },
      );
    }
    // MAX>1: cai pra a próxima iteração — uma SÍNTESE PAGA a mais (a regeneração).
  }

  // 12. Persistência (sequencial — neon-http não suporta transação real).
  // 12a. ai_call (status ok) — id alimenta palpite_sets.aiCallId.
  const cost = calculateCost({ model: servedModel, inputTokens, outputTokens });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: servedModel.id,
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
      .returning({ id: aiCalls.id });
    aiCallId = row.id;
  } catch (err) {
    // ASSIMETRIA INTENCIONAL: aiCallId=null no insert do ai_call que falha é
    // DELIBERADO (ADR 0028 §1, FK nullable em palpite_sets). O set é o produto e
    // SOBREVIVE à falha do log de auditoria. Não throw aqui. (Contraste: a falha
    // do insert de palpite_set SIM faz throw — sem child rows órfãs.)
    console.error(
      JSON.stringify({
        scope: "generatePalpites",
        matchId,
        error: "ai_call_insert_failed",
        ...extractDbCause(err),
      }),
    );
  }

  // 12b. palpite_set — parent. RETURNING id p/ a linha filha. Falha aqui PROPAGA
  //      (throw): sem set, não há filho a inserir — nada de órfãos. `headline` jsonb
  //      carrega a manchete (sem placar — esse vira a linha settleable); proveniência
  //      = os predictionIds das análises que alimentaram a síntese (ADR 0030 §4).
  const { sourcePredictionIds } = spec;
  // O raciocínio do run (ADR 0065): as etapas que rodaram até aqui, mais a síntese, que
  // termina com este insert. Vazio fora de um run com progresso (cron, script).
  const synthesis = synthesisStep(spec.live !== null);
  // Confiança calculada pelo motor (#649, ADR 0069): a chance do resultado do placar
  // provável, não a palavra do LLM.
  const confidence = palpiteConfidence(output.probableScore, spec.confidenceProbs);
  stepDetail(synthesis, [...synthesisDetail(confidence), ...spec.analysesLines]);
  const reasoning = progressTrace({ assumeDone: synthesis });
  let setRow: DbPalpiteSet;
  try {
    const [row] = await db
      .insert(palpiteSets)
      .values({
        matchId,
        userId,
        aiCallId, // pode ser null
        modelVersion: servedModel.id,
        promptVersion: cartridge.version,
        headline: {
          verdict: output.verdict,
          confidence: confidence?.level ?? null,
          confidenceProbPct: confidence?.probPct ?? null,
          confidenceSource: confidence?.source ?? "none",
          narrative: output.narrative,
          citedMarkets: output.citedMarkets,
          sourcePredictionIds,
          // ADR 0032 / #377 — fontes de notícia REAIS capturadas que alimentaram o
          // palpite (no jsonb existente, sem migration). Omitido quando não houve notícia.
          ...(spec.sources.length > 0 ? { sources: spec.sources } : {}),
          ...(reasoning.length > 0 ? { reasoning } : {}),
        },
        // Palpite ao vivo (#594): is_live + o carimbo. Pré-jogo: as colunas no default.
        ...(spec.live ? spec.live : {}),
      })
      .returning();
    setRow = row;
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "generatePalpites",
        matchId,
        userId,
        error: "palpite_set_insert_failed",
        ...cause,
      }),
    );
    throw new PalpiteError("failed to persist palpite_set", cause);
  }

  // 12c. palpites — N linhas derivadas da síntese (#354): sempre exact_score (o placar
  //      provável, o ponto central conferido) + 0..4 dimensões goal-derived
  //      (margin/clean_sheet/first_half_score/first_to_score) EMITIDAS só quando
  //      coerentes (gate em buildSettleablePalpiteRows). v8 (#419) também emite, quando
  //      cardsTemperature está presente, uma linha FUN-ONLY `cards` (settleable=false
  //      derivado → NUNCA entra no cron; o #394 a promove a liquidável). settleable
  //      DERIVADO da constante de tipo (NUNCA do LLM); params/text de templates FIXOS já
  //      passaram pelo guard de value-language acima. Insert em batch único; `inserted` é
  //      o array completo de rows. NÃO gera red_card/corners (gate Tier 3 de pé, ADR 0028).
  const rows = settleableRows.map((r) => ({ ...r, palpiteSetId: setRow.id }));
  const inserted = await db.insert(palpites).values(rows).returning();

  return {
    palpiteSet: setRow,
    palpites: inserted,
    aiCall: aiCallId ? { id: aiCallId } : null,
  };
}

/**
 * Palpite AO VIVO (#594, ADR 0060 §8.2, PLAN-580 §12): a manchete sobre a leitura ao vivo
 * (as predictions is_live do mesmo momento). Sem forma/confrontos/tabela e sem notícias:
 * só a situação do jogo, os placares finais mais prováveis do modelo em jogo e as chances
 * por mercado. Cartucho palpites_live_v2 (output sem 1º tempo/primeiro a marcar/cartões);
 * placar provável abaixo do atual falha fechado (Zod, invalid_output: o veredito e a
 * narrativa foram escritos pra esse placar, trocar só o placar deixaria a manchete se
 * contradizendo); linhas só exact_score/margin/clean_sheet; o set grava is_live +
 * carimbo.
 */
export async function generateLivePalpites({
  matchId,
  userId,
  analyses,
  live,
  modelOverride,
  deadlineAt,
}: GenerateLivePalpiteArgs): Promise<PalpiteGenerationResult> {
  const model = MODEL_REGISTRY[modelOverride ?? UTILITY_MODEL_ID];
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PalpiteError("match not found", { matchId });
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new PalpiteError("match is not analyzable", {
      matchId,
      status: match.status,
    });
  }
  const { state, scoreline, moment, now } = live;
  const score = state.score;
  const cartridge = palpitesLiveCartridge;
  const input = cartridge.buildInput({
    match: {
      league: LEAGUE_LABEL[leagueToKey(match.league)],
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    },
    situation: { moment, score, red: state.red },
    matrix: scoreline.matrix,
    analyses,
  });
  // Placar provável abaixo do atual (gols não se desfazem): o veredito e a narrativa do
  // LLM foram escritos pra esse placar, então só trocar o placar deixaria a manchete se
  // contradizendo. Falha fechado pelo caminho do Zod (invalid_output auditado → sem
  // manchete, as leituras seguem na página), sem 2ª chamada paga. O cartucho (prompt,
  // tool e schema) não muda: a regra já está no prompt; aqui só é conferida.
  const outputSchema = cartridge.outputSchema.superRefine((output, ctx) => {
    if (
      output.probableScore.home < score.home ||
      output.probableScore.away < score.away
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["probableScore"],
        message: `placar provável ${output.probableScore.home}–${output.probableScore.away} abaixo do placar atual ${score.home}–${score.away}`,
      });
    }
  });
  const stamp = liveStampFromState(state, now, scoreline.inPlay);
  return runSynthesis<PalpiteLiveOutput>({
    userId,
    matchId,
    model,
    cartridge: { ...cartridge, outputSchema },
    userMessage: cartridge.buildUserMessage(input),
    deadlineAt,
    rowsFor: (output) => buildLivePalpiteRows("", output),
    fidelity: (output) => cartridge.checkFidelity(output, input),
    sourcePredictionIds: analyses.map((a) => a.predictionId),
    sources: [],
    live: liveColumns(stamp),
    analysesLines: analysesDetail(analyses),
    // Ao vivo, a matriz do placar final do modelo em jogo (a mesma das leituras).
    confidenceProbs: liveConfidenceProbs(scoreline.matrix),
  });
}
