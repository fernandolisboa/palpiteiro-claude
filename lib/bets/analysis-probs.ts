import { referenceKey, SLIP_TOTAL_LINES } from "@/lib/bets/slip-markets";

// "Um número por linha" (#556): quando o usuário já tem uma análise daquele mercado
// (e linha) neste jogo, a probabilidade da perna é a da análise — a mesma que a página
// mostra em "Ler análise completa", com o JEV aplicado pelo motor code_jev —, não o
// Dixon-Coles cru. Sem análise, a perna usa o modelo de placar (lib/bets/slip-model).
// Leitura do histórico que a página/ação já buscam; nada de LLM.

export type AnalysisMarket = {
  predictionId: string;
  createdAt: Date;
  // Probabilidade (0–100) por seleção do mercado, só as que a análise gravou.
  probs: Record<string, number>;
};

type HistoryRow = {
  marketKey: string | null;
  prediction: {
    id: string;
    createdAt: Date;
    marketParams: { line?: number | null } | null;
  };
  selections: { key: string; modelProbPct: number; modelProbKnown?: boolean }[];
};

const SLIP_MARKETS = new Set(["match_result", "double_chance", "btts", "over_under"]);

/** Última análise por mercado(+linha), a partir do histórico ordenado do mais novo. */
export function latestAnalysisByMarket(
  history: readonly HistoryRow[],
): Map<string, AnalysisMarket> {
  const out = new Map<string, AnalysisMarket>();
  for (const row of history) {
    const marketKey = row.marketKey ?? "over_under";
    if (!SLIP_MARKETS.has(marketKey)) continue;
    let line: number | null = null;
    if (marketKey === "over_under") {
      const raw = row.prediction.marketParams?.line;
      if (raw === undefined || raw === null) continue;
      line = Number(raw);
      if (!SLIP_TOTAL_LINES.some((l) => l === line)) continue;
    }
    const key = referenceKey({
      dbMarketKey: marketKey as "over_under",
      line,
    });
    if (out.has(key)) continue; // já tem uma mais nova
    const probs: Record<string, number> = {};
    for (const s of row.selections) {
      if (s.modelProbKnown === false) continue;
      if (Number.isFinite(s.modelProbPct)) probs[s.key] = s.modelProbPct;
    }
    if (Object.keys(probs).length === 0) continue;
    out.set(key, {
      predictionId: row.prediction.id,
      createdAt: row.prediction.createdAt,
      probs,
    });
  }
  return out;
}
