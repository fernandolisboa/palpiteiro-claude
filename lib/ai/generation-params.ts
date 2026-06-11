// Parâmetros de GERAÇÃO da análise (distintos do modelo em si): calibráveis em
// /admin/settings e persistidos em `ai_config` (ADR 0008, emenda 2). O consumo é
// MODEL-AWARE no request-builder (espelhando a bifurcação por thinkingMode):
//   - maxTokens   → vale pra TODOS (é teto; inofensivo pros temperature, que nem
//                   usam a folga, mas crítico pros adaptive — thinking conta dentro)
//   - effort      → SÓ modelos adaptive (Sonnet 4.5/Haiku retornam erro com effort)
//   - temperature → SÓ modelos temperature-mode (adaptive dá 400 em sampling)
//
// Camada pura (sem DB) pra ser testável isolada e reusada pela query layer, pela
// server action (validação) e pela UI (sem vazar server-only pro client).

export type Effort = "low" | "medium" | "high" | "max";

// Níveis oferecidos na calibração. Restritos a low/medium/high/max: TODOS os
// modelos adaptive do registry (Fable 5, Opus 4.8, Sonnet 4.6) suportam estes,
// inclusive `max`. `xhigh` é omitido de propósito — nem todo adaptive o aceita
// (ex.: Sonnet 4.6), o que daria 400 model-specific.
export const EFFORT_LEVELS: readonly Effort[] = [
  "low",
  "medium",
  "high",
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
// tool call); effort high = default do servidor; temperature 0.3 = default
// histórico dos modelos temperature-mode no registry.
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
