"use server";

import { revalidatePath } from "next/cache";

import type { PalpiteResultData } from "@/db/schema";
import { auth } from "@/auth";
import { upsertPalpiteOutcomeOverride } from "@/lib/db/queries/palpite-outcomes";
import { getPalpiteById } from "@/lib/db/queries/palpites";
import { upsertOutcomeOverride } from "@/lib/db/queries/prediction-outcomes";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";
import { profitForResult, type OutcomeResult } from "@/lib/settlement/compute";
import { resultDataFromRegulationScore } from "@/lib/settlement/schemas";

export type OverrideResult = { ok: true } | { ok: false; error: string };

const VALID_RESULTS: ReadonlySet<string> = new Set<OutcomeResult>([
  "won",
  "lost",
  "void",
  // push entra no override em #168 (devolve o stake, profit 0). O domínio já o
  // carrega desde #161/#166; a regra "sem odd → só void" o cobre abaixo.
  "push",
]);

/**
 * Manual settlement override. Lets an admin set the 90' score + result for a
 * prediction — correcting a wrong auto-settle, voiding an annulled match, or
 * settling something the cron couldn't. Profit is derived from the chosen
 * result + the prediction's entry odd/stake, never typed by hand, so it stays
 * consistent.
 *
 * Acesso restrito a admin: muta outcomes passados (integridade de Yield), então
 * exige sessão com role "admin". Defense-in-depth com o gate em
 * app/admin/layout.tsx.
 */
export async function overridePredictionOutcome(
  _prev: OverrideResult | null,
  formData: FormData,
): Promise<OverrideResult> {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return { ok: false, error: "Acesso restrito." };
  }

  const predictionId = String(formData.get("predictionId") ?? "");
  const result = String(formData.get("result") ?? "");
  // Parse from the raw field: Number(null) is 0, so an absent/empty score must
  // be rejected BEFORE conversion — otherwise a crafted no-body request would
  // settle a bet on a fabricated 0-0.
  const homeRaw = formData.get("homeScore");
  const awayRaw = formData.get("awayScore");

  if (!predictionId) return { ok: false, error: "predictionId ausente." };
  if (!VALID_RESULTS.has(result)) {
    return { ok: false, error: "Resultado inválido." };
  }
  if (
    typeof homeRaw !== "string" ||
    typeof awayRaw !== "string" ||
    homeRaw.trim() === "" ||
    awayRaw.trim() === ""
  ) {
    return { ok: false, error: "Placar (90') ausente." };
  }
  const homeScore = Number(homeRaw);
  const awayScore = Number(awayRaw);
  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    return { ok: false, error: "Placar (90') inválido." };
  }

  const row = await getPredictionForOverride(predictionId);
  if (!row) return { ok: false, error: "Predição não encontrada." };

  const odd =
    row.prediction.oddAtRecommendation !== null
      ? Number(row.prediction.oddAtRecommendation)
      : null;
  // Regra preservada (ADR 0016): uma predição sem odd de entrada não é uma aposta
  // precificável — só pode ser ANULADA (void). Vale pra won/lost E push: push
  // "devolve o stake", mas sem odd não houve aposta. profitForResult(push, null)
  // devolve 0 (não null), então é este guard explícito — não o null-check abaixo —
  // que barra um push sem odd.
  if (odd === null && result !== "void") {
    return {
      ok: false,
      error: "Predição sem odd de entrada; só pode ser anulada (void).",
    };
  }
  const profitUnits = profitForResult(
    result as OutcomeResult,
    odd,
    Number(row.prediction.stakeUnits),
  );
  if (profitUnits === null) {
    // Inalcançável após o guard acima (won/lost sempre têm odd aqui; void/push →
    // 0); narrowing de TS + defesa em profundidade.
    return {
      ok: false,
      error: "Predição sem odd de entrada; só pode ser anulada (void).",
    };
  }

  // O override já tem os scores inteiros do placar (90'): o split é confiável.
  // resultDataFromRegulationScore valida via Zod (mesma fronteira do cron, #166) e
  // é a fonte única de totalGoals (jsonb result_data).
  const resultData = resultDataFromRegulationScore({
    home: homeScore,
    away: awayScore,
  });

  await upsertOutcomeOverride({
    predictionId,
    resultData,
    result: result as OutcomeResult,
    profitUnits,
    overrideByUserId: session.user.id,
  });
  revalidatePath(`/admin/predictions/${predictionId}`);
  return { ok: true };
}

// won/lost só pra palpites: void/push não se aplicam a placar/proposição (sem stake,
// ADR 0028 §1). Restringe ANTES de qualquer escrita.
const VALID_PALPITE_RESULTS: ReadonlySet<string> = new Set<"won" | "lost">([
  "won",
  "lost",
]);

/**
 * Override MANUAL de liquidação de PALPITE (#394) — a saída pra rows de cartão stuck
 * (cap esgotado / A≠B perpétuo) ou já liquidadas errado. Espelha
 * overridePredictionOutcome MAS no domínio de palpite: won/lost só, SEM odd/stake/profit.
 *
 * O `yellowCardsTotal` é OPCIONAL e digitado à mão: quando presente é validado (inteiro
 * ≥0) e gravado no resultData; quando ausente grava resultData=null (override puro
 * operator-trust). EM AMBOS os casos a row é TRUST-THE-ADMIN — NÃO re-validada pela regra
 * pura contra `line` (o admin é a autoridade, igual ao override de predição).
 *
 * Acesso restrito a admin (muta outcome passado): defense-in-depth com o gate de
 * app/admin/layout.tsx.
 */
export async function overridePalpiteOutcome(
  _prev: OverrideResult | null,
  formData: FormData,
): Promise<OverrideResult> {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return { ok: false, error: "Acesso restrito." };
  }

  const palpiteId = String(formData.get("palpiteId") ?? "");
  const result = String(formData.get("result") ?? "");
  // Lê do campo cru ANTES de qualquer conversão: um POST sem corpo não pode fabricar um
  // outcome (mesma disciplina homeRaw/awayRaw do override de predição).
  const yellowRaw = formData.get("yellowCardsTotal");

  if (!palpiteId) return { ok: false, error: "palpiteId ausente." };
  if (!VALID_PALPITE_RESULTS.has(result)) {
    return { ok: false, error: "Resultado inválido (won/lost)." };
  }

  // yellowCardsTotal opcional. Ausente/vazio → resultData null (override puro). Presente →
  // valida inteiro ≥0 e grava o fato. NUNCA aceita um valor não-inteiro/negativo.
  let resultData: PalpiteResultData | null = null;
  if (typeof yellowRaw === "string" && yellowRaw.trim() !== "") {
    const yellow = Number(yellowRaw);
    if (!Number.isInteger(yellow) || yellow < 0) {
      return { ok: false, error: "Total de amarelos inválido." };
    }
    resultData = {
      homeScore: null,
      awayScore: null,
      totalGoals: 0,
      yellowCardsTotal: yellow,
    };
  }

  // Guard de existência (espelha overridePredictionOutcome): sem isto um palpiteId
  // inexistente estouraria a FK de palpite_outcomes como exceção não-tratada em vez do
  // contrato {ok:false}. Roda DEPOIS das validações de input (reject-empty-first preservado).
  const palpite = await getPalpiteById(palpiteId);
  if (!palpite) return { ok: false, error: "Palpite não encontrado." };

  await upsertPalpiteOutcomeOverride({
    palpiteId,
    resultData,
    result: result as "won" | "lost",
    overrideByUserId: session.user.id,
  });
  // SEM revalidatePath deliberado: não existe rota de admin keyed por palpiteId (ao
  // contrário de /admin/predictions/[id]). O badge no jogo/compartilhamento é
  // dinamicamente lido do DB e pega o override no próximo render — uma revalidação
  // adivinhada (ex.: /p/<setId>, que NÃO é o palpiteId) tocaria o caminho errado.
  return { ok: true };
}
