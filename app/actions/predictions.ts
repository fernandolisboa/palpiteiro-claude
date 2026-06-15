"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { getCartridge } from "@/lib/ai/markets/registry";
import { isModelAllowedForAudience, type AIModelId } from "@/lib/ai/models";
import { PredictError, predict } from "@/lib/ai/predict";
import { getEnableOverUnderExtraLines } from "@/lib/db/queries/ai-config";
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
import type { AnalysisView } from "@/lib/view/types";

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
  // FK ai_calls_user_id_users_id_fk estoura pós-gasto). `allowed=false` = bloqueado:
  // recusa todo mundo, inclusive admin (admins são `allowed=true` no DB — ADR 0023).
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  if (!access.allowed) {
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
