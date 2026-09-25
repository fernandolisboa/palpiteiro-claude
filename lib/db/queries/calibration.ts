import { and, eq, inArray, ne, or } from "drizzle-orm";

import {
  marketSelections,
  markets,
  predictionOutcomes,
  predictionSelectionOdds,
  predictions,
} from "@/db/schema";
import { db } from "@/lib/db";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

// Query READ-TIME do harness de calibração (Report 03 rec. 3, ADR 0037) — SEM
// migration, tudo já persistido. Um par por predição over/under LIQUIDADA com P(over)
// do modelo: (p_model, p_market no-vig, aconteceu over?), rotulado pela versão de
// prompt e por `isBet` (recomendou aposta vs pass). Passes ENTRAM: o forecast e o
// placar são reais — só o resultado financeiro é void. Só over/under (o mercado do
// tracer #482); as métricas puras (lib/calibration) estendem pros outros mercados
// quando ganharem P(seleção) + outcome binário.

export type OverUnderCalibrationRow = {
  promptVersion: string;
  modelPOver: number; // 0-1, P(over) do modelo (LLM ancorado no Poisson)
  marketPOver: number; // 0-1, implícita de-vigada (benchmark)
  overHappened: 0 | 1;
  isBet: boolean; // false = pass (no-bet); o gate da Fase C conta só apostas
};

export async function getOverUnderCalibrationRows(): Promise<
  OverUnderCalibrationRow[]
> {
  // 1. Resolve o mercado over/under + suas seleções over/under.
  const [ou] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.key, "over_under"))
    .limit(1);
  if (!ou) return [];

  const sels = await db
    .select({ id: marketSelections.id, key: marketSelections.key })
    .from(marketSelections)
    .where(eq(marketSelections.marketId, ou.id));
  const overSelId = sels.find((s) => s.key === "over")?.id;
  const underSelId = sels.find((s) => s.key === "under")?.id;
  if (!overSelId || !underSelId) return [];

  // 2. Predições over/under LIQUIDADAS (outcome presente) + a linha e o totalGoals.
  const settled = await db
    .select({
      id: predictions.id,
      promptVersion: predictions.promptVersion,
      recommendation: predictions.recommendation,
      marketParams: predictions.marketParams,
      resultData: predictionOutcomes.resultData,
    })
    .from(predictions)
    .innerJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    // O settle só liquida jogo `finished` com placar 90' — então `void` vem de dois
    // caminhos: `pass` (computeSettlement curto-circuita pass → void/0 com o placar
    // REAL no resultData) ou override manual do admin numa aposta (jogo anulado →
    // rótulo sem sentido). Pass entra; void de aposta sai. won/lost/push têm placar
    // real (em push k+0.5 não ocorre; num inteiro legado, over=total>line segue
    // determinado).
    .where(
      and(
        eq(predictions.marketId, ou.id),
        or(
          ne(predictionOutcomes.result, "void"),
          eq(predictions.recommendation, "pass"),
        ),
      ),
    );
  if (settled.length === 0) return [];

  // 3. PSO das seleções over/under dessas predições (odd por seleção + modelProbPct do over).
  const predIds = settled.map((s) => s.id);
  const pso = await db
    .select({
      predictionId: predictionSelectionOdds.predictionId,
      selectionId: predictionSelectionOdds.selectionId,
      odd: predictionSelectionOdds.odd,
      modelProbPct: predictionSelectionOdds.modelProbPct,
    })
    .from(predictionSelectionOdds)
    .where(
      and(
        inArray(predictionSelectionOdds.predictionId, predIds),
        inArray(predictionSelectionOdds.selectionId, [overSelId, underSelId]),
      ),
    );

  // predictionId → { overOdd, overModelPct, underOdd }
  const byPred = new Map<
    string,
    { overOdd?: number; overModelPct?: number; underOdd?: number }
  >();
  for (const row of pso) {
    const slot = byPred.get(row.predictionId) ?? {};
    if (row.selectionId === overSelId) {
      slot.overOdd = Number(row.odd);
      slot.overModelPct =
        row.modelProbPct === null ? undefined : Number(row.modelProbPct);
    } else if (row.selectionId === underSelId) {
      slot.underOdd = Number(row.odd);
    }
    byPred.set(row.predictionId, slot);
  }

  // 4. Monta os pares. Só entram predições com P(over) do modelo, as duas odds pra
  //    de-vigar, e (linha + totalGoals) pra determinar o evento.
  const rows: OverUnderCalibrationRow[] = [];
  for (const s of settled) {
    const line = s.marketParams?.line;
    const totalGoals = s.resultData?.totalGoals;
    const slot = byPred.get(s.id);
    if (
      line === undefined ||
      totalGoals === undefined ||
      totalGoals === null ||
      !slot ||
      slot.overModelPct === undefined ||
      slot.overOdd === undefined ||
      slot.underOdd === undefined
    ) {
      continue;
    }
    // De-vig pode lançar se alguma odd congelada vier ≤ 1 (validada >1 na escrita, mas
    // uma row corrompida não pode derrubar a página inteira) — pula a row, não 500.
    let marketPOver: number;
    try {
      marketPOver = computeMarketImpliedProbabilities([
        slot.overOdd,
        slot.underOdd,
      ]).probs[0];
    } catch {
      continue;
    }
    rows.push({
      promptVersion: s.promptVersion,
      modelPOver: slot.overModelPct / 100,
      marketPOver,
      overHappened: totalGoals > line ? 1 : 0,
      isBet: s.recommendation !== "pass",
    });
  }
  return rows;
}
