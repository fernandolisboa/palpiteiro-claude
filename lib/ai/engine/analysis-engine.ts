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

// Leitura do motor a partir de `predictions.model_version` (ADR 0041 §5, #513). O
// code_jev grava "<modelId>;engine=code_jev;lambda=…;judg=…;w=…"; o caminho llm grava
// só o id do modelo. Puro — a calibração segmenta por aqui.
function versionTags(modelVersion: string): string[] {
  return modelVersion
    .split(";")
    .slice(1)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Motor que produziu a predição. Sem tag `engine=` → 'llm' (todo o histórico
 * pré-#511 e o caminho de hoje). Tag com motor desconhecido → null: não atribuível,
 * pra não contaminar o segmento 'llm' com algo que claramente não é o LLM.
 */
export function engineFromModelVersion(
  modelVersion: string
): AnalysisEngine | null {
  const tag = versionTags(modelVersion).find((t) => t.startsWith("engine="));
  if (tag === undefined) return "llm";
  const engine = tag.slice("engine=".length);
  return isAnalysisEngine(engine) ? engine : null;
}

/**
 * Configuração do motor sem o id do modelo nem a própria tag `engine=` — ex.
 * "lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1". É o que versiona o
 * NÚMERO no code_jev (lá o promptVersion é o do narrador, que só escreve o texto).
 * null quando não há tags (caminho llm).
 */
export function engineConfigFromModelVersion(
  modelVersion: string
): string | null {
  const tags = versionTags(modelVersion).filter(
    (t) => !t.startsWith("engine=")
  );
  return tags.length ? tags.join(";") : null;
}
