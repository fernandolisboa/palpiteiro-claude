"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import {
  MAX_ADDITIONAL_FETCHES,
  MAX_FANOUT_MARKETS,
  capCandidates,
  runFanOut,
  type FanOutMarket,
} from "@/lib/ai/best-bet";
import { getCartridge } from "@/lib/ai/markets/registry";
import { isModelAllowedForAudience, type AIModelId } from "@/lib/ai/models";
import { PredictError, predict } from "@/lib/ai/predict";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import {
  getEnableBestBetFanOut,
  getEnableOverUnderExtraLines,
} from "@/lib/db/queries/ai-config";
import { extractDbCause } from "@/lib/db/pg-error";
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";
import { toAnalysisView } from "@/lib/view/analysis";
import { toBestBetView } from "@/lib/view/best-bet";
import type { AnalysisView, BestBetView } from "@/lib/view/types";

export type AnalyzeMatchResult =
  | { ok: true; view: AnalysisView }
  | { ok: false; error: string };

function friendlyMessage(err: PredictError): string {
  // PredictError.context contém detalhes técnicos; aqui mapeamos mensagens
  // conhecidas pra UI sem vazar implementação.
  const msg = err.message.toLowerCase();
  if (msg.includes("match not found")) {
    return "Jogo não encontrado.";
  }
  if (msg.includes("match is not analyzable")) {
    return "Este jogo já foi encerrado ou cancelado.";
  }
  if (msg.includes("no matching odds")) {
    return "Sem odds publicadas para este jogo no momento.";
  }
  if (msg.includes("no over/under 2.5 odds")) {
    return "Nenhum bookmaker oferece over/under 2.5 para este jogo.";
  }
  // Mercado *additional* (btts) sem snapshot fresco = o pre-warm por evento não
  // achou book ofertando o mercado pra este jogo (degradou sem escrever).
  if (msg.includes("sem snapshot fresco")) {
    return "Nenhum bookmaker oferece este mercado para o jogo no momento.";
  }
  if (msg.includes("fixture not found in provider")) {
    return "Dados do jogo indisponíveis no provider esportivo.";
  }
  if (msg.includes("standings row missing")) {
    return "Dados de classificação indisponíveis pra esta análise.";
  }
  if (msg.includes("zod validation")) {
    return "A resposta do modelo não passou na validação. Nenhum custo cobrado.";
  }
  return "Falha temporária ao gerar análise. Tente novamente.";
}

export async function analyzeMatch(
  _prev: AnalyzeMatchResult | null,
  formData: FormData,
): Promise<AnalyzeMatchResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  // Guarda load-bearing de custo/abuso (#264, ADR 0023): leitura DIRETA do DB de
  // `allowed` ANTES de qualquer chamada paga ao Anthropic — independente da
  // frescura do JWT (que pode estar stale). `null` = row sumiu (reset +
  // claim-admin com cookie velho): recusa a sessão órfã antes do custo (senão a
  // FK ai_calls_user_id_users_id_fk estoura pós-gasto).
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  // Compõe com o floor do env ANTES de decidir (ADR 0023 §3/§6, mesma semântica
  // de `isEmailAllowedWithDb`/`isSignInAllowed`): um e-mail no floor do env é
  // permitido MESMO com `allowed=false` no DB. Um read cru de `allowed` trancaria
  // o dono/admin do floor (cuja row pode ser `allowed=false`) do próprio app — o
  // auto-lockout que a §6 promete impossível. Bloqueio só morde quem NÃO está no
  // floor e tem `allowed=false`.
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  // Teto diário por usuário (Upstash Ratelimit via Vercel KV): recusa ANTES de
  // qualquer chamada paga ao Anthropic. Admin tem limite separado/maior. Sem KV
  // configurado, o fallback é por role — admin fail-open, não-admin fail-closed
  // (ADR 0023) — ver lib/rate-limit.ts.
  const rateLimit = await checkAnalysisRateLimit(
    session.user.id,
    session.user.role,
  );
  if (!rateLimit.ok) {
    // reason:"fail-closed" = KV ausente p/ não-admin, não um teto real atingido:
    // a copy de "limite de 0 análises" seria enganosa. Discriminador explícito
    // (não `limit === 0`) pra um limit:0 legítimo do Upstash nunca a disparar.
    if (rateLimit.reason === "fail-closed") {
      return {
        ok: false,
        error: "Análises temporariamente indisponíveis. Tente mais tarde.",
      };
    }
    return {
      ok: false,
      error: `Você atingiu o limite de ${rateLimit.limit} análises por dia. Tente novamente amanhã.`,
    };
  }
  // Override de modelo por análise, gateado por AUDIÊNCIA (ADR 0013) e revalidado
  // aqui (server actions são POST chamáveis fora do layout): usuário comum só
  // pode escolher modelos userSelectable; admin enxerga todos.
  // "default"/inválido/fora-da-audiência → cai no default global (sem erro).
  // Defense-in-depth além de esconder o seletor/limitar a lista na UI.
  const isAdmin = session.user.role === "admin";
  const overrideRaw = String(formData.get("modelOverride") ?? "");
  let modelOverride: AIModelId | undefined;
  if (
    overrideRaw &&
    overrideRaw !== "default" &&
    isModelAllowedForAudience(overrideRaw, isAdmin)
  ) {
    modelOverride = overrideRaw;
  }
  // Mercado a analisar, gateado por AUDIÊNCIA (ADR 0017) e re-validado AQUI
  // (server actions são POST chamáveis fora do layout): usuário comum só pode
  // escolher mercados graduados; admin enxerga também os ativos-não-graduados
  // (match_result hoje). Um `marketKey` ausente/inválido/fora-da-audiência cai no
  // default over_under (sem erro) — defesa-em-profundidade além de esconder/limitar
  // o seletor na UI. NUNCA gateado em predict.ts (ADR 0017).
  // O match é carregado AQUI (não só em predict) porque o gate de cobertura de liga
  // (#158) precisa de `match.league` ANTES da coerção do marketKey + da chamada paga.
  // Read barato vs LLM pago. predict() re-valida match/analisabilidade depois.
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  // Analisabilidade ANTES do pre-warm de odds (#174 code review): um jogo
  // encerrado/cancelado faria o pre-warm por evento gastar 1 crédito (additional)
  // só pra o predict lançar depois. Curto-circuita aqui (status já em escopo,
  // read grátis), market-agnóstico — espelha o gate de predict.ts.
  if (match.status === "finished" || match.status === "cancelled") {
    return { ok: false, error: "Este jogo já foi encerrado ou cancelado." };
  }
  const marketKeyRaw = String(formData.get("marketKey") ?? "");
  // Audiência ∩ cobertura de liga (#158): um POST forjado com `marketKey=btts` numa
  // liga sem cobertura (ex.: brasileirao) é coercido a over_under ANTES de gastar.
  const allowedMarkets = marketsForLeague(
    await marketsForAudience(isAdmin),
    match.league,
  );
  const marketKey = allowedMarkets.some((m) => m.key === marketKeyRaw)
    ? marketKeyRaw
    : "over_under";
  // Linhas extras de over/under (#175): flag global (ai_config) ∩ cobertura da
  // variante multi-linha pra a liga deste match. getCartridge({extraLines}) devolve a
  // variante onde existir (over_under → v3); `candidateLines` a distingue da base e
  // `coveredLeagues` (data-driven, como btts/dc) restringe às ligas validadas. Liga
  // sem cobertura → extraLines=false → caminho featured 2.5 (graceful). Sem literal
  // de mercado: mercados sem variante caem na base mesmo com a flag ligada.
  const extraLinesEnabled = await getEnableOverUnderExtraLines();
  const variantDescriptor = getCartridge(marketKey, {
    extraLines: extraLinesEnabled,
  }).descriptor;
  const extraLines =
    extraLinesEnabled &&
    variantDescriptor.candidateLines !== undefined &&
    (variantDescriptor.coveredLeagues === undefined ||
      variantDescriptor.coveredLeagues.includes(match.league));
  try {
    // Mercado *additional* (btts/dupla chance OU over_under multi-linha sob flag):
    // pré-aquece a snapshot por evento (lazy, 1 crédito, deduplicado pelo gate de
    // frescor) ANTES do predict, pra o caminho de reuso fresco sempre acertar (predict
    // nunca batcheia additional). O descriptor EFETIVO sai de getCartridge(extraLines)
    // — over_under multi-linha vira additional (alternate_totals). Data-driven por
    // oddsSource, nunca `if (market==='btts')`.
    const effectiveDescriptor = getCartridge(marketKey, {
      extraLines,
    }).descriptor;
    if (effectiveDescriptor.oddsSource === "additional") {
      await ensureOddsSnapshotsFresh(match, {
        markets: [effectiveDescriptor],
      });
    }
    // predict() retorna o carrier N-vias { prediction, marketKey, selections }. O
    // marketKey RESOLVIDO + o candidate set alimentam a view N-vias (1X2 → grade
    // de 3) — síncrono, antes de qualquer re-query.
    const { prediction, marketKey: resolvedMarketKey, selections } =
      await predict({
        matchId,
        userId: session.user.id,
        isAdmin,
        modelOverride,
        marketKey,
        extraLines,
      });
    const aiCall = await getAiCallById(prediction.aiCallId);
    revalidatePath(`/match/${matchId}`);
    revalidatePath("/");
    return {
      ok: true,
      view: toAnalysisView(
        {
          recommendation: prediction.recommendation,
          confidencePct: prediction.confidencePct,
          rationale: prediction.rationale,
          keyFactors: prediction.keyFactors,
          minimumOdd: prediction.minimumOdd,
          oddAtRecommendation: prediction.oddAtRecommendation,
          bookmaker: prediction.bookmaker,
          impliedProbPct: prediction.impliedProbPct,
          edgePct: prediction.edgePct,
          overOddAtPrediction: prediction.overOddAtPrediction,
          underOddAtPrediction: prediction.underOddAtPrediction,
          modelVersion: prediction.modelVersion,
          promptVersion: prediction.promptVersion,
          createdAt: prediction.createdAt,
          // Fiação multi-mercado (#170/#173): marketKey RESOLVIDO por predict()
          // (não o literal 'over_under'); `line` da forma do mercado salva (null em
          // 1X2); stake da row recém-gravada; candidate set N-vias retornado por
          // predict() → grade de 3 colunas em 1X2 (toAnalysisView ramifica).
          marketKey: resolvedMarketKey,
          line: prediction.marketParams?.line ?? null,
          stakeUnits: prediction.stakeUnits,
          selections,
        },
        aiCall ? { costUsd: aiCall.costUsd } : null,
      ),
    };
  } catch (err) {
    if (err instanceof PredictError) {
      console.error(
        JSON.stringify({
          scope: "analyzeMatch",
          matchId,
          error: "predict_failed",
          message: err.message,
          context: err.context,
        }),
      );
      return { ok: false, error: friendlyMessage(err) };
    }
    const dbCause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "analyzeMatch",
        matchId,
        error: "unexpected",
        message: err instanceof Error ? err.message : String(err),
        pgCode: dbCause.code,
        constraint: dbCause.constraint,
        detail: dbCause.detail,
        table: dbCause.table,
        column: dbCause.column,
      }),
    );
    return {
      ok: false,
      error: "Falha temporária ao gerar análise. Tente novamente.",
    };
  }
}

// ─── Modo "melhor aposta do jogo" (#178) ─────────────────────────────────────

export type AnalyzeBestBetResult =
  | { ok: true; view: BestBetView }
  | { ok: false; error: string };

// Mapeia QUALQUER erro pra mensagem amigável de UI. PredictError reusa o
// friendlyMessage; o resto (inesperado: DB etc.) cai numa cópia genérica. Fica
// server-side (passado pro orquestrador e pro pré-warm) — nunca vaza pro cliente.
function friendlyMessageFromUnknown(err: unknown): string {
  if (err instanceof PredictError) return friendlyMessage(err);
  return "Falha temporária ao gerar análise. Tente novamente.";
}

// Resolve extraLines pra UM mercado — port VERBATIM do bloco inline do analyzeMatch
// (L166-174), sem reler a flag (vem por parâmetro). Descriptor-driven, SEM literal de
// mercado: getCartridge(extraLines) devolve a variante onde existir (over_under→v3),
// `candidateLines` a distingue da base, `coveredLeagues` restringe às ligas validadas.
// analyzeMatch NÃO adota este helper neste PR (mantém o single-market intocado/golden).
function resolveExtraLines(
  marketKey: string,
  league: string,
  flagEnabled: boolean,
): boolean {
  const d = getCartridge(marketKey, { extraLines: flagEnabled }).descriptor;
  return (
    flagEnabled &&
    d.candidateLines !== undefined &&
    (d.coveredLeagues === undefined ||
      d.coveredLeagues.some((l) => l === league))
  );
}

/**
 * Fan-out cross-mercado: analisa TODOS os mercados ativos do jogo (audiência ∩ liga),
 * uma predição REAL por mercado (cada uma logada em ai_calls), ranqueadas no cliente.
 *
 * Ordem dos gates é LOAD-BEARING: o flag re-check e o guard de candidatos-vazios vêm
 * ANTES do checkAnalysisRateLimit (que INCREMENTA o contador — é consumo, não leitura),
 * pra um POST flag-off ou um jogo sem mercado NUNCA queimar um slot diário. Rate-limit
 * é o ÚLTIMO gate antes do spend. Best-of-successful: 1 mercado falho não derruba o run.
 */
export async function analyzeBestBet(
  _prev: AnalyzeBestBetResult | null,
  formData: FormData,
): Promise<AnalyzeBestBetResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  // Compõe com o floor do env (ADR 0023 §3/§6, #276): um e-mail no floor é permitido
  // mesmo com `allowed=false` no DB — espelha o gate do analyzeMatch.
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  // Flag re-check server-side ANTES de qualquer spend E antes do incremento do
  // rate-limit (server actions são POST chamáveis fora do layout): flag-off = recurso
  // indisponível, sem queimar slot.
  const bestBetEnabled = await getEnableBestBetFanOut();
  if (!bestBetEnabled) {
    return { ok: false, error: "Recurso indisponível." };
  }
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  if (match.status === "finished" || match.status === "cancelled") {
    return { ok: false, error: "Este jogo já foi encerrado ou cancelado." };
  }
  const isAdmin = session.user.role === "admin";
  const overrideRaw = String(formData.get("modelOverride") ?? "");
  let modelOverride: AIModelId | undefined;
  if (
    overrideRaw &&
    overrideRaw !== "default" &&
    isModelAllowedForAudience(overrideRaw, isAdmin)
  ) {
    modelOverride = overrideRaw;
  }
  // Candidatos = audiência ∩ cobertura de liga (a MESMA expressão do analyzeMatch +
  // page.tsx). Cap retendo Tier-1 (over/under + 1X2) p/ teto de LLM calls.
  const candidates = capCandidates(
    marketsForLeague(await marketsForAudience(isAdmin), match.league),
    MAX_FANOUT_MARKETS,
  );
  if (candidates.length === 0) {
    return { ok: false, error: "Nenhum mercado disponível para este jogo." };
  }
  // Linhas extras (#175): flag SEPARADA (enable_over_under_extra_lines), NÃO a do
  // best-bet. Resolvida UMA vez por candidato no FanOutMarket — o MESMO valor alimenta
  // o pré-warm e o predict (senão predict resolveria um cartucho diferente do aquecido).
  const extraLinesEnabled = await getEnableOverUnderExtraLines();
  const fanOut: FanOutMarket[] = candidates.map((c) => ({
    marketKey: c.key,
    extraLines: resolveExtraLines(c.key, match.league, extraLinesEnabled),
  }));
  // Rate-limit é o ÚLTIMO gate antes do spend (incrementa 1× por run).
  const rateLimit = await checkAnalysisRateLimit(
    session.user.id,
    session.user.role,
  );
  if (!rateLimit.ok) {
    if (rateLimit.reason === "fail-closed") {
      return {
        ok: false,
        error: "Análises temporariamente indisponíveis. Tente mais tarde.",
      };
    }
    return {
      ok: false,
      error: `Você atingiu o limite de ${rateLimit.limit} análises por dia. Tente novamente amanhã.`,
    };
  }
  // Pré-aquece os mercados *additional* (btts/dupla chance/over_under multi-linha): o
  // descriptor EFETIVO sai do MESMO m.extraLines do FanOutMarket. Cada um numa chamada
  // própria (ensureOddsSnapshotsFresh hard-throws em seed faltante) → a falha de um vira
  // erro POR mercado, sem abortar os irmãos. Teto de créditos additional/run.
  const additional = fanOut
    .map((m) => ({
      marketKey: m.marketKey,
      descriptor: getCartridge(m.marketKey, { extraLines: m.extraLines })
        .descriptor,
    }))
    .filter((x) => x.descriptor.oddsSource === "additional");
  const additionalToFetch =
    additional.length > MAX_ADDITIONAL_FETCHES
      ? additional.slice(0, MAX_ADDITIONAL_FETCHES)
      : additional;
  console.info(
    JSON.stringify({
      scope: "analyzeBestBet",
      matchId,
      candidates: fanOut.length,
      additionalFetches: additionalToFetch.length,
    }),
  );
  const preWarmErrors: { marketKey: string; message: string }[] = [];
  for (const { marketKey: mk, descriptor } of additionalToFetch) {
    try {
      await ensureOddsSnapshotsFresh(match, { markets: [descriptor] });
    } catch (err) {
      preWarmErrors.push({
        marketKey: mk,
        message: friendlyMessageFromUnknown(err),
      });
    }
  }
  // Fan-out SERIAL: predict() por candidato (a única porta pro LLM), best-of-successful.
  const outcomes = await runFanOut(
    { matchId, userId: session.user.id, isAdmin, modelOverride },
    fanOut,
    friendlyMessageFromUnknown,
  );
  // Custo por análise bem-sucedida (lê a aiCall pra exibir).
  const aiCallByMarketKey = new Map<
    string,
    { costUsd: string | number } | null
  >();
  for (const o of outcomes) {
    if (o.ok) {
      const aiCall = await getAiCallById(o.result.prediction.aiCallId);
      aiCallByMarketKey.set(
        o.marketKey,
        aiCall ? { costUsd: aiCall.costUsd } : null,
      );
    }
  }
  const view = toBestBetView(outcomes, aiCallByMarketKey, preWarmErrors);
  if (view.entries.length === 0) {
    // Todos falharam → estado de erro (espelha o total-failure do analyzeMatch), NÃO um
    // sucesso vazio. O run pode ter pago ≤N calls pós-Anthropic + 1 slot — surge como erro.
    return {
      ok: false,
      error: view.errors[0]?.message ?? "Nenhum mercado pôde ser analisado.",
    };
  }
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/");
  return { ok: true, view };
}
