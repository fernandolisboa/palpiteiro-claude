"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { upsertOutcomeOverride } from "@/lib/db/queries/prediction-outcomes";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";
import { profitForResult, type OutcomeResult } from "@/lib/settlement/compute";

export type OverrideResult = { ok: true } | { ok: false; error: string };

const VALID_RESULTS: ReadonlySet<string> = new Set<OutcomeResult>([
  "won",
  "lost",
  "void",
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
  const profitUnits = profitForResult(
    result as OutcomeResult,
    odd,
    Number(row.prediction.stakeUnits),
  );
  if (profitUnits === null) {
    return {
      ok: false,
      error: "Predição sem odd de entrada; só pode ser anulada (void).",
    };
  }

  await upsertOutcomeOverride({
    predictionId,
    totalGoals: homeScore + awayScore,
    // O override já tem os scores inteiros do placar (90'): o split é confiável,
    // grava o result_data rico completo.
    resultData: {
      homeScore,
      awayScore,
      totalGoals: homeScore + awayScore,
    },
    result: result as OutcomeResult,
    profitUnits,
    overrideByUserId: session.user.id,
  });
  revalidatePath(`/admin/predictions/${predictionId}`);
  return { ok: true };
}
