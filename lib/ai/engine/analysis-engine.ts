// Motor de análise (ADR 0041 §5, #511). Coluna `ai_config.analysis_engine` (text
// validado na app, como defaultModelId). 'llm' = o cartucho de mercado decide (caminho
// de hoje); 'code_jev' = o código decide (λ + julgamentos JEV) e o LLM só narra.
export const ANALYSIS_ENGINES = ["llm", "code_jev"] as const;
export type AnalysisEngine = (typeof ANALYSIS_ENGINES)[number];

export const DEFAULT_ANALYSIS_ENGINE: AnalysisEngine = "llm";

export const ANALYSIS_ENGINE_LABEL: Record<AnalysisEngine, string> = {
  llm: "LLM (atual)",
  code_jev: "Código + JEV",
};

export function isAnalysisEngine(v: unknown): v is AnalysisEngine {
  return (
    typeof v === "string" && (ANALYSIS_ENGINES as readonly string[]).includes(v)
  );
}
