"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
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
