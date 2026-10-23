// Personagem ao lado do progresso do "Analisar com IA" (ADR 0068). Coluna
// `ai_config.progress_mascot` (text validado na app, como analysis_engine), escolhida
// em /admin/ia: o robozinho da ADR 0065 (padrão) ou o papagaio mascote.
export const PROGRESS_MASCOTS = ["robo", "papagaio"] as const;
export type ProgressMascot = (typeof PROGRESS_MASCOTS)[number];

export const DEFAULT_PROGRESS_MASCOT: ProgressMascot = "robo";

export const PROGRESS_MASCOT_LABEL: Record<ProgressMascot, string> = {
  robo: "Robozinho",
  papagaio: "Papagaio",
};

export function isProgressMascot(v: unknown): v is ProgressMascot {
  return typeof v === "string" && (PROGRESS_MASCOTS as readonly string[]).includes(v);
}
