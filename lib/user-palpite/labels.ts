import type { JudgmentQuestionId, TeamSide } from "@/lib/ai/judgments/types";
import type { DixonColesFallbackReason, ModelScorelineSource } from "@/lib/quant/match-model";

import type { TeamNames } from "./reading";
import type { ClaimStatus, ClaimTopic } from "./types";

// Rótulos em PT-BR do "Seu palpite" (#564). PURO e seguro no cliente: a tela, o
// narrador e o template usam os MESMOS textos.

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  confirmed: "confirmada",
  contradicted: "contradita",
  unverifiable: "não verificável",
};

export const TOPIC_LABEL: Record<ClaimTopic, string> = {
  absence: "desfalque",
  full_squad: "time completo",
  form: "momento",
  rotation: "rodízio",
  stakes: "peso do jogo",
  other: "outro",
};

function sideOf(id: JudgmentQuestionId): TeamSide {
  return id.endsWith("_home") ? "home" : "away";
}

/** O que a afirmação fez no modelo, por fator do JEV. */
export function effectLabel(id: JudgmentQuestionId, teams: TeamNames): string {
  const side = sideOf(id);
  const team = side === "home" ? teams.home : teams.away;
  const opponent = side === "home" ? teams.away : teams.home;
  if (id.startsWith("attack_weakened")) return `ataque do ${team} ajustado para baixo`;
  if (id.startsWith("defense_weakened")) {
    return `gols esperados do ${opponent} ajustados para cima`;
  }
  if (id.startsWith("rotation_risk")) {
    return `risco de rodízio no ${team} (ataque ajustado para baixo)`;
  }
  return `jogo de peso pro ${team} (ataque ajustado para cima)`;
}

const FALLBACK_LABEL: Record<DixonColesFallbackReason, string> = {
  flag_off: "Dixon-Coles desligado",
  no_fit: "liga sem ajuste",
  stale_fit: "ajuste desatualizado",
  team_missing: "time sem histórico",
  few_matches: "pouco histórico",
  error: "erro nos ratings",
};

/**
 * "Dixon-Coles · JEV aplicado" | "heurístico da tabela (liga sem ajuste) · dados
 * limitados · JEV não aplicado" | "… · base do jogo desatualizada · JEV não aplicado".
 * Mesma convenção do sourceLabel da "Leitura do modelo" (lib/view/match-model.ts).
 */
export function modelLabel(m: {
  source: ModelScorelineSource;
  degraded: boolean;
  fallbackReason: DixonColesFallbackReason | null;
  staleBase: boolean;
  jevApplied: boolean;
}): string {
  const base =
    m.source === "dixon_coles"
      ? "Dixon-Coles"
      : m.fallbackReason
        ? `heurístico da tabela (${FALLBACK_LABEL[m.fallbackReason]})`
        : "heurístico da tabela";
  return [
    base,
    ...(m.degraded ? ["dados limitados"] : []),
    ...(m.staleBase ? ["base do jogo desatualizada"] : []),
    m.jevApplied ? "JEV aplicado" : "JEV não aplicado",
  ].join(" · ");
}
