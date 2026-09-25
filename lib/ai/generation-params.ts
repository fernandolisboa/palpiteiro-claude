// Parâmetros de GERAÇÃO da análise (distintos do modelo em si): calibráveis em
// /admin/settings e persistidos em `ai_config` (ADR 0008, emenda 2). O consumo é
// MODEL-AWARE no request-builder (espelhando a bifurcação por thinkingMode):
//   - maxTokens   → vale pra TODOS (é teto; inofensivo pros temperature, que nem
//                   usam a folga, mas crítico pros adaptive — thinking conta dentro)
//   - effort      → SÓ modelos adaptive, via output_config.effort (Sonnet 4.5/Haiku
//                   retornam erro com effort)
//   - temperature → SÓ modelos temperature-mode (adaptive dá 400 em sampling)
//
// Camada pura (sem DB) pra ser testável isolada e reusada pela query layer, pela
// server action (validação) e pela UI (sem vazar server-only pro client).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Níveis oferecidos na calibração. `xhigh` voltou com #524: TODOS os modelos
// adaptive do registry (Fable 5.1, Opus 5.5, Sonnet 5) aceitam low..max inclusive
// xhigh. (Antes ele era omitido porque o Sonnet 4.6 não o aceitava.) Um adaptive
// futuro sem xhigh exige tirar o nível daqui ou torná-lo model-aware.
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
  temperature: number;
};

// Defaults seguros — espelham o seed da migration e o fallback da query layer.
// maxTokens 16000 = recomendação não-streaming da Anthropic (cabe thinking + a
// tool call); effort high = sempre enviado explícito (o default do servidor varia
// por modelo: `medium` no Opus 5.5); temperature 0.3 = default histórico dos
// modelos temperature-mode no registry.
export const GENERATION_PARAM_DEFAULTS: GenerationParams = {
  maxTokens: 16000,
  effort: "high",
  temperature: 0.3,
};

// Limites de validação. A server action revalida; a UI só sugere via input.
export const MAX_TOKENS_MIN = 1024;
export const MAX_TOKENS_MAX = 32000;
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1;

export function isValidMaxTokens(n: number): boolean {
  return Number.isInteger(n) && n >= MAX_TOKENS_MIN && n <= MAX_TOKENS_MAX;
}

export function isValidTemperature(n: number): boolean {
  return Number.isFinite(n) && n >= TEMPERATURE_MIN && n <= TEMPERATURE_MAX;
}
