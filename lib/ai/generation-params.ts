// Parâmetros de GERAÇÃO da análise (distintos do modelo em si): calibráveis em
// /admin/ia e persistidos em `ai_config` (ADR 0008, emenda 2):
//   - maxTokens → teto de saída; o thinking conta dentro
//   - effort    → profundidade do thinking, via output_config.effort
// Sem `temperature` desde o ADR 0061: nenhum modelo do registry aceita sampling fora
// do default (400). A coluna ai_config.temperature fica no banco, sem uso.
//
// Camada pura (sem DB) pra ser testável isolada e reusada pela query layer, pela
// server action (validação) e pela UI (sem vazar server-only pro client).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Níveis oferecidos na calibração. TODOS os modelos do registry (Haiku, Sonnet e
// Opus 5.5) aceitam low..max inclusive xhigh. Um modelo futuro sem algum nível exige
// tirá-lo daqui ou torná-lo model-aware.
export const EFFORT_LEVELS: readonly Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export function isEffort(v: unknown): v is Effort {
  return (
    typeof v === "string" && (EFFORT_LEVELS as readonly string[]).includes(v)
  );
}

export type GenerationParams = {
  maxTokens: number;
  effort: Effort;
};

// Defaults seguros — espelham o seed da migration e o fallback da query layer.
// maxTokens 16000 = recomendação não-streaming da Anthropic (cabe thinking + a
// tool call); effort high = sempre enviado explícito (o default do servidor varia
// por modelo: `medium` no Opus e no Haiku 5.5).
export const GENERATION_PARAM_DEFAULTS: GenerationParams = {
  maxTokens: 16000,
  effort: "high",
};

// Limites de validação. A server action revalida; a UI só sugere via input.
export const MAX_TOKENS_MIN = 1024;
export const MAX_TOKENS_MAX = 32000;

export function isValidMaxTokens(n: number): boolean {
  return Number.isInteger(n) && n >= MAX_TOKENS_MIN && n <= MAX_TOKENS_MAX;
}
