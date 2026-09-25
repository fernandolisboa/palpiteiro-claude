import { getAnalysisEngine } from "@/lib/db/queries/ai-config";

import type { AnalysisEngine } from "./analysis-engine";

// Leitura do flag `analysis_engine` pro predict (ADR 0041 §5), memoizada por
// instância. TTL curto (60s, vs 1h do gate do Kelly) pra um flip no admin valer
// rápido; num fan-out serial evita uma query por mercado.
const TTL_MS = 60 * 1000;
let memo: { at: number; engine: AnalysisEngine } | null = null;

/**
 * FAIL-SAFE: qualquer erro de leitura → 'llm' (o caminho de hoje), sem memoizar
 * a falha (a próxima análise tenta ler de novo). O motor novo nunca liga por
 * acidente.
 */
export async function readAnalysisEngine(
  now = Date.now()
): Promise<AnalysisEngine> {
  if (memo && now - memo.at < TTL_MS) return memo.engine;
  try {
    const engine = await getAnalysisEngine();
    memo = { at: now, engine };
    return engine;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "predict",
        error: "analysis_engine_read_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return "llm";
  }
}

/** Zera o memo: o flip no admin (mesma instância) e os testes. */
export function resetAnalysisEngineMemo(): void {
  memo = null;
}
