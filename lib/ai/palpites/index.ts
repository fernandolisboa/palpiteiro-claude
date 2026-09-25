import { eq } from "drizzle-orm";

import { aiCalls, matches, palpiteSets, palpites } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import type { DbPalpiteSet } from "@/lib/db/queries/palpites";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { FixtureRef } from "@/lib/providers/sports-data/types";
import { getNewsProvider } from "@/lib/providers/news";
import type { NewsResult } from "@/lib/providers/news/types";
import {
  getGenerationParams,
  getEnableFidelityValidation,
} from "@/lib/db/queries/ai-config";

import { persistAiCallError } from "../ai-call-logging";
import { calculateCost } from "../cost";
import { AnalysisDeadlineError, canFitCall } from "../deadline";
import { MODEL_REGISTRY, isAIProvider, type AIModelId } from "../models";
import { getProviderForModel } from "../providers";
import type { AnalysisRequest } from "../providers/types";
import { type PalpiteSynthesisOutput } from "./cartridges/cartridge";
import { checkFidelity } from "./fidelity-validator";
import { getPalpiteCartridge } from "./registry";
import { buildSettleablePalpiteRows } from "./settleable-rows";
import { containsValueLanguage } from "./value-language-guard";
import {
  PalpiteError,
  type GeneratePalpiteArgs,
  type PalpiteGenerationResult,
} from "./types";

export { PalpiteError } from "./types";
export type {
  GeneratePalpiteArgs,
  PalpiteGenerationResult,
} from "./types";

const FORM_LAST = 5;
const H2H_LAST = 5;

// #380 — quantas SÍNTESES PAGAS no máximo por geração quando a validação de fidelidade
// está ON. DEFAULT = 1: na divergência, DEGRADA IMEDIATAMENTE (palpite:null) sem pagar
// uma 2ª chamada. Racional: uma contagem errada a temp 0.3 na MESMA request é sistemática,
// não ruído de amostragem → re-rodar raramente recupera; descartar o palpite é a escolha
// honesta e custo-neutra (alinha com prefer-skip-over-silent-wrong). Subir pra 2 (uma
// regeneração) é um flip trivial de preferência do dono — e valeria um nudge de prompt
// corretivo na retry pra a regen valer o custo (non-goal de v1).
const MAX_FIDELITY_ATTEMPTS = 1;

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
 * Default Haiku (econômico, temperature-mode). Fetch de suporte ENXUTO (form/h2h/
 * standings) como cor narrativa — crucial no caso all-pass (veredito apoia na forma).
 */
export async function generatePalpites({
  matchId,
  userId,
  analyses,
  modelOverride,
  deadlineAt,
}: GeneratePalpiteArgs): Promise<PalpiteGenerationResult> {
  // 1. Modelo: SEM cascata de preferência (palpite é universal). Fixo no registry.
  const resolvedModelId: AIModelId = modelOverride ?? "claude-haiku-4-5";
  const model = MODEL_REGISTRY[resolvedModelId];

  // 2. Lookup do match. Backstop de analisabilidade da SÍNTESE — só barra estados
  //    TERMINAIS (finished/cancelled → throw). NÃO espelha o gate de pré-jogo do
  //    predict (#385: scheduled E kickoff no futuro): a síntese roda DEPOIS das
  //    análises (que já passaram pelo gate endurecido em predict.ts + o
  //    notAnalyzableMessage da action), então re-rejeitar por kickoff aqui
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
  // Notícias (ADR 0032 / #377): provider DEDICADO via web search da Claude, em paralelo
  // ao fetch de suporte. Degrada GRACIOSO (mirror absences): QUALQUER falha → results:[]
  // e o palpite ainda embarca — NUNCA bloqueia a manchete por notícia. O provider já loga
  // seu próprio ai_call (predict.ts é a única porta); aqui só capturamos o resultado.
  const newsFetch = getNewsProvider()
    .getNewsByMatch(
      {
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt.toISOString(),
      },
      { userId, matchId },
    )
    .catch((err) => {
      console.error(
        JSON.stringify({
          scope: "generatePalpites",
          matchId,
          error: "news_fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return { results: [] as NewsResult[], aiCall: null, unavailable: true };
    });

  const [fixture, homeForm, awayForm, h2h, standings, newsOutcome] =
    await Promise.all([
      provider.getFixtureByMatch(ref),
      provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
      provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
      provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
      provider.getStandings(match.league),
      newsFetch,
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

  // 7. AnalysisRequest. temperature EXPLÍCITO de model.temperature (0.3 p/ Haiku) —
  //    NÃO genParams.temperature (null em temperature-mode). SEM effort (Haiku é
  //    temperature-mode; effort seria ignorado). maxTokens de getGenerationParams.
  const genParams = await getGenerationParams();
  const analysisRequest: AnalysisRequest = {
    model,
    system: cartridge.systemPrompt,
    userMessage,
    tool: cartridge.tool,
    toolName: cartridge.toolName,
    maxTokens: genParams.maxTokens,
    temperature: model.temperature,
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
  let output: PalpiteSynthesisOutput;
  let settleableRows: ReturnType<typeof buildSettleablePalpiteRows>;
  let latencyMs: number;
  let inputTokens: number;
  let outputTokens: number;
  let inputPayload: Record<string, unknown>;
  let outputPayload: Record<string, unknown>;

  for (let attempt = 1; ; attempt += 1) {
    // Prazo do run (#524): sem tempo pra uma chamada inteira, não chama — nada gasto e
    // nenhuma row 0/0 de timeout falso em ai_calls. O caller trata como síntese falha.
    if (
      !canFitCall(deadlineAt, {
        thinkingMode: model.thinkingMode,
        maxTokens: analysisRequest.maxTokens,
        effort: analysisRequest.effort,
      })
    ) {
      throw new AnalysisDeadlineError();
    }
    const result = await aiProvider.runAnalysis(analysisRequest);
    latencyMs = result.latencyMs;

    // 9. Erro do provider.
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
      throw new PalpiteError("LLM output failed Zod validation", {
        issues: parsed.error.issues,
      });
    }
    // Já tipado pelo schema concreto do cartucho (diferente de predict, que apaga
    // para BaseMarketOutput).
    const candidate: PalpiteSynthesisOutput = parsed.data;

    // 11b. FIREWALL leg (b) — guard de CONTEÚDO pós-Zod (ADR 0030 §3, blocker #5). O
    //      `.strict()` só barra chaves; o LLM pode ecoar um TERMO de valor numa string.
    //      Rodamos sobre TODO campo que cruza pra manchete/view: verdict + narrative +
    //      o `text` derivado de CADA linha settleable (templates fixos, #354) + os
    //      rótulos de citedMarkets (LLM-livre, vão verbatim pro PalpiteHeadlineView). Hit
    //      → tratado como `invalid_output` (mesmo path auditado do Zod) → throw → degrada
    //      pra palpite:null no try/catch do analyzeBestBet. REJEITAR > VAZAR. As rows são
    //      construídas AQUI (puras, sem DB) e reusadas no insert em batch (12c).
    const candidateRows = buildSettleablePalpiteRows("", candidate);
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
        model: model.id,
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
    const fidelity = checkFidelity(candidate, input);
    if (fidelity.ok) {
      output = candidate;
      settleableRows = candidateRows;
      break;
    }
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
  const cost = calculateCost({ model: model.id, inputTokens, outputTokens });
  let aiCallId: string | null = null;
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
  const sourcePredictionIds = analyses.map((a) => a.predictionId);
  let setRow: DbPalpiteSet;
  try {
    const [row] = await db
      .insert(palpiteSets)
      .values({
        matchId,
        userId,
        aiCallId, // pode ser null
        modelVersion: model.id,
        promptVersion: cartridge.version,
        headline: {
          verdict: output.verdict,
          confidence: output.confidence,
          narrative: output.narrative,
          citedMarkets: output.citedMarkets,
          sourcePredictionIds,
          // ADR 0032 / #377 — fontes de notícia REAIS capturadas que alimentaram o
          // palpite (no jsonb existente, sem migration). Omitido quando não houve notícia.
          ...(newsOutcome.results.length > 0
            ? { sources: newsOutcome.results }
            : {}),
        },
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
