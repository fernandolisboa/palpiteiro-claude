import { and, eq, inArray, ne, or } from "drizzle-orm";

import {
  marketSelections,
  markets,
  predictionOutcomes,
  predictionSelectionOdds,
  predictions,
} from "@/db/schema";
import {
  engineConfigFromModelVersion,
  engineFromModelVersion,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
import {
  CALIBRATED_MARKETS,
  POSITIVE_SELECTION,
  isCalibratedMarket,
  type CalibratedMarketKey,
} from "@/lib/calibration/markets";
import type { CalibrationPair } from "@/lib/calibration/metrics";
import { db } from "@/lib/db";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { getSettlementRule } from "@/lib/settlement/registry";
import { ResultDataSchema } from "@/lib/settlement/schemas";

// Query READ-TIME do harness de calibração (Report 03 rec. 3, ADR 0037, #453) — SEM
// migration, tudo já persistido. Uma row por predição LIQUIDADA dos mercados de
// partição do MVP (lib/calibration/markets.ts), com os pares (p, y) do modelo e do
// mercado no-vig (benchmark), rotulada pela versão de prompt, pelo MOTOR (ADR 0041
// §5, #513, lido do `modelVersion`) e por `isBet` (recomendou aposta vs pass).
// Passes ENTRAM: o forecast e o placar são reais — só o resultado financeiro é void.
//
// O evento y de cada seleção sai da MESMA regra pura do settlement (registry): won →
// 1, lost → 0. push/half (linha inteira de over/under empatada) não é binário — a
// predição sai inteira. Row corrompida (odd ≤ 1, resultData inválido, params que a
// regra rejeita) é pulada, nunca derruba a página.

export type MarketCalibrationRow = {
  marketKey: CalibratedMarketKey;
  promptVersion: string;
  isBet: boolean; // false = pass (no-bet); o gate da Fase C conta só apostas
  // Motor que produziu o número (sem tag → 'llm'; tag desconhecida → null).
  engine: AnalysisEngine | null;
  // Tags do motor no modelVersion (ex. "lambda=heuristic;judg=…;w=…"); null no llm.
  engineConfig: string | null;
  // Pares alinhados (mesma seleção, mesmo y, na mesma ordem): 1 no binário, N no
  // N-ário (um-contra-o-resto) — ver POSITIVE_SELECTION.
  model: CalibrationPair[];
  market: CalibrationPair[];
};

export async function getMarketCalibrationRows(
  only: readonly CalibratedMarketKey[] = CALIBRATED_MARKETS,
): Promise<MarketCalibrationRow[]> {
  // 1. Mercados calibrados + as seleções seedadas de cada um.
  const mks = await db
    .select({
      id: markets.id,
      key: markets.key,
      ruleKey: markets.settlementRuleKey,
    })
    .from(markets)
    .where(inArray(markets.key, [...only]));
  if (mks.length === 0) return [];

  const sels = await db
    .select({
      id: marketSelections.id,
      key: marketSelections.key,
      marketId: marketSelections.marketId,
    })
    .from(marketSelections)
    .where(
      inArray(
        marketSelections.marketId,
        mks.map((m) => m.id),
      ),
    );

  const marketById = new Map<
    string,
    {
      key: CalibratedMarketKey;
      ruleKey: string;
      selections: { id: string; key: string }[];
    }
  >();
  for (const m of mks) {
    if (!isCalibratedMarket(m.key)) continue;
    marketById.set(m.id, {
      key: m.key,
      ruleKey: m.ruleKey,
      selections: sels
        .filter((s) => s.marketId === m.id)
        // Ordem estável: a de-vig é por posição e os pares saem nessa ordem.
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(({ id, key }) => ({ id, key })),
    });
  }

  // 2. Predições LIQUIDADAS (outcome presente) desses mercados.
  const settled = await db
    .select({
      id: predictions.id,
      marketId: predictions.marketId,
      promptVersion: predictions.promptVersion,
      modelVersion: predictions.modelVersion,
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
    // rótulo sem sentido). Pass entra; void de aposta sai.
    .where(
      and(
        inArray(predictions.marketId, [...marketById.keys()]),
        or(
          ne(predictionOutcomes.result, "void"),
          eq(predictions.recommendation, "pass"),
        ),
      ),
    );
  if (settled.length === 0) return [];

  // 3. PSO de todas as seleções dessas predições (odd + modelProbPct por seleção).
  const pso = await db
    .select({
      predictionId: predictionSelectionOdds.predictionId,
      selectionId: predictionSelectionOdds.selectionId,
      odd: predictionSelectionOdds.odd,
      modelProbPct: predictionSelectionOdds.modelProbPct,
    })
    .from(predictionSelectionOdds)
    .where(
      inArray(
        predictionSelectionOdds.predictionId,
        settled.map((s) => s.id),
      ),
    );

  // predictionId → selectionId → { odd, modelPct }
  const byPred = new Map<
    string,
    Map<string, { odd: number; modelPct: number | null }>
  >();
  for (const row of pso) {
    const slot = byPred.get(row.predictionId) ?? new Map();
    slot.set(row.selectionId, {
      odd: Number(row.odd),
      modelPct: row.modelProbPct === null ? null : Number(row.modelProbPct),
    });
    byPred.set(row.predictionId, slot);
  }

  // 4. Monta os pares.
  const rows: MarketCalibrationRow[] = [];
  for (const s of settled) {
    const market = s.marketId ? marketById.get(s.marketId) : undefined;
    const slot = byPred.get(s.id);
    if (!market || !slot) continue;
    const pairs = buildPairs(market, slot, s.marketParams, s.resultData);
    if (!pairs) continue;
    rows.push({
      marketKey: market.key,
      promptVersion: s.promptVersion,
      isBet: s.recommendation !== "pass",
      engine: engineFromModelVersion(s.modelVersion),
      engineConfig: engineConfigFromModelVersion(s.modelVersion),
      ...pairs,
    });
  }
  return rows;
}

function buildPairs(
  market: {
    key: CalibratedMarketKey;
    ruleKey: string;
    selections: { id: string; key: string }[];
  },
  slot: Map<string, { odd: number; modelPct: number | null }>,
  marketParams: unknown,
  rawResultData: unknown,
): { model: CalibrationPair[]; market: CalibrationPair[] } | null {
  const resultData = ResultDataSchema.safeParse(rawResultData);
  if (!resultData.success || market.selections.length === 0) return null;

  // De-vig sobre o mercado COMPLETO (CLAUDE.md: nunca 1/odd cru) — exige a odd de
  // toda seleção seedada. Dupla chance escala Σ=1 → Σ=2 (impliedSumTarget, a mesma
  // escala do modelProbPct persistido).
  const odds: number[] = [];
  for (const sel of market.selections) {
    const odd = slot.get(sel.id)?.odd;
    if (odd === undefined) return null;
    odds.push(odd);
  }
  let probs: number[];
  try {
    probs = computeMarketImpliedProbabilities(odds).probs;
  } catch {
    return null; // odd congelada ≤ 1: row corrompida
  }
  const target = getDescriptor(market.key)?.impliedSumTarget ?? 1;

  let rule: ReturnType<typeof getSettlementRule>;
  try {
    rule = getSettlementRule(market.ruleKey);
  } catch {
    return null;
  }

  const positive = POSITIVE_SELECTION[market.key];
  const model: CalibrationPair[] = [];
  const marketPairs: CalibrationPair[] = [];
  for (const [i, sel] of market.selections.entries()) {
    if (positive !== null && sel.key !== positive) continue;
    const modelPct = slot.get(sel.id)?.modelPct;
    if (modelPct === null || modelPct === undefined) return null;
    let outcome: string;
    try {
      outcome = rule(sel.key, marketParams, resultData.data);
    } catch {
      return null; // params inválidos / split de placar ausente
    }
    if (outcome !== "won" && outcome !== "lost") return null; // push/half
    const y = outcome === "won" ? 1 : 0;
    model.push({ p: modelPct / 100, y });
    marketPairs.push({ p: Math.min(1, probs[i] * target), y });
  }
  // Seleção positiva não seedada (seed quebrado): nada a medir.
  if (model.length === 0) return null;
  return { model, market: marketPairs };
}

// ── Recorte over/under (Fase C) ─────────────────────────────────────────────
// O gate do Kelly (ADR 0039) e o skill pareado são só de over/under: esta visão
// estreita mantém o contrato original (um par por predição, P(over)).

export type OverUnderCalibrationRow = {
  promptVersion: string;
  modelPOver: number; // 0-1, P(over) do modelo (LLM ancorado no Poisson)
  marketPOver: number; // 0-1, implícita de-vigada (benchmark)
  overHappened: 0 | 1;
  isBet: boolean; // false = pass (no-bet); o gate da Fase C conta só apostas
  engine: AnalysisEngine | null;
  engineConfig: string | null;
};

export function toOverUnderRows(
  rows: MarketCalibrationRow[],
): OverUnderCalibrationRow[] {
  return rows
    .filter((r) => r.marketKey === "over_under")
    .map((r) => ({
      promptVersion: r.promptVersion,
      modelPOver: r.model[0].p,
      marketPOver: r.market[0].p,
      overHappened: r.model[0].y,
      isBet: r.isBet,
      engine: r.engine,
      engineConfig: r.engineConfig,
    }));
}

export async function getOverUnderCalibrationRows(): Promise<
  OverUnderCalibrationRow[]
> {
  return toOverUnderRows(await getMarketCalibrationRows(["over_under"]));
}
