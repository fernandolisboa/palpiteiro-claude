"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { isModelAllowedForAudience, type AIModelId } from "@/lib/ai/models";
import { PredictError, predict } from "@/lib/ai/predict";
import { extractDbCause } from "@/lib/db/pg-error";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { userExists } from "@/lib/db/queries/users";
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
  // Sessão JWT carrega o id do login; se a row do usuário sumiu (reset +
  // claim-admin com cookie velho), recusa ANTES de gastar uma chamada paga ao
  // Anthropic (senão a FK ai_calls_user_id_users_id_fk estoura pós-custo).
  if (!(await userExists(session.user.id))) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  // Teto diário por usuário (Upstash Ratelimit via Vercel KV): recusa ANTES de
  // qualquer chamada paga ao Anthropic. Admin tem limite separado/maior. Sem KV
  // configurado (dev local) o gate falha aberto — ver lib/rate-limit.ts.
  const rateLimit = await checkAnalysisRateLimit(
    session.user.id,
    session.user.role,
  );
  if (!rateLimit.ok) {
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
  const marketKeyRaw = String(formData.get("marketKey") ?? "");
  const allowedMarkets = await marketsForAudience(isAdmin);
  const marketKey = allowedMarkets.some((m) => m.key === marketKeyRaw)
    ? marketKeyRaw
    : "over_under";
  try {
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
