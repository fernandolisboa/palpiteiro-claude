import type { JudgmentQuestionId, TeamSide } from "@/lib/ai/judgments/types";
import type { DixonColesFallbackReason, ModelScorelineSource } from "@/lib/quant/match-model";

import type { TeamNames } from "./reading";
import type { ClaimStatus, ClaimTopic, OtherKind, StoredContextClaim } from "./types";

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

// Rótulo curto do subtipo de "other" (#569), no lugar de "outro" na tela.
export const OTHER_KIND_LABEL: Record<OtherKind, string> = {
  coach_change: "troca de técnico",
  derby: "clássico",
  weather: "clima",
  travel_fatigue: "viagem",
  crowd: "torcida",
  motivation: "motivação",
};

type TypedClaim = Pick<StoredContextClaim, "team" | "topic" | "otherKind">;

/** O tópico na tela: o subtipo quando a afirmação "other" tem um. */
export function claimTopicLabel(c: Pick<TypedClaim, "topic" | "otherKind">): string {
  return c.topic === "other" && c.otherKind ? OTHER_KIND_LABEL[c.otherKind] : TOPIC_LABEL[c.topic];
}

/**
 * A afirmação "other" com subtipo em uma frase montada SÓ pelo código (#569): enum +
 * nome do time, nunca a paráfrase. Clássico e clima são do jogo, não de um time.
 */
export function otherKindLine(kind: OtherKind, team: TypedClaim["team"], teams: TeamNames): string {
  const name = team === "home" ? teams.home : teams.away;
  const both = team === "both";
  switch (kind) {
    case "coach_change":
      return both ? "troca de técnico nos dois times" : `troca de técnico no ${name}`;
    case "derby":
      return "clássico entre os dois times";
    case "weather":
      return "clima ou gramado que pode pesar no jogo";
    case "travel_fatigue":
      return both ? "desgaste de viagem dos dois times" : `desgaste de viagem do ${name}`;
    case "crowd":
      return both ? "torcida como fator no jogo" : `torcida como fator pro ${name}`;
    case "motivation":
      return both ? "motivação dos dois times como fator" : `motivação do ${name} como fator`;
  }
}

/** Tem afirmação que vira nota pro narrador da análise (contextNotes não vazio). */
export function hasContextNote(claims: readonly TypedClaim[]): boolean {
  return claims.some((c) => c.topic === "other" && c.otherKind !== undefined);
}

/**
 * As notas do contexto extra que o narrador `code_jev` recebe (#569): uma por
 * afirmação "other" com subtipo, sem repetir. Não conferidas e sem efeito no número.
 */
export function contextNotes(claims: readonly TypedClaim[], teams: TeamNames): string[] {
  const lines = claims.flatMap((c) =>
    c.topic === "other" && c.otherKind
      ? [otherKindLine(c.otherKind, c.team, teams)]
      : [],
  );
  return [...new Set(lines)];
}

const ROLE_PT: Record<NonNullable<StoredContextClaim["role"]>, string> = {
  attack: "no ataque",
  defense: "na defesa",
  goalkeeper: "no gol",
  unknown: "no elenco",
};

/**
 * A afirmação descrita SÓ pelos campos tipados (#565): nunca a paráfrase nem nome de
 * jogador. É o texto que a tela mostra no "o que você acrescentou".
 */
export function claimDescription(
  c: Pick<
    StoredContextClaim,
    "team" | "topic" | "role" | "direction" | "scope" | "playersCount" | "otherKind"
  >,
  teams: TeamNames,
): string {
  const team =
    c.team === "both" ? "os dois times" : c.team === "home" ? teams.home : teams.away;
  const of = c.team === "both" ? "dos dois times" : `do ${team}`;
  const forTeam = c.team === "both" ? "pros dois times" : `pro ${team}`;
  switch (c.topic) {
    case "absence": {
      const n = c.playersCount ?? 0;
      return `desfalque ${ROLE_PT[c.role ?? "unknown"]} ${of}${n > 1 ? ` (${n} jogadores citados)` : ""}`;
    }
    case "full_squad": {
      const scope =
        c.scope === "injuries" ? " (lesões)" : c.scope === "suspensions" ? " (suspensões)" : "";
      return `${team} sem desfalques${scope}`;
    }
    case "form":
      return `${team} em ${c.direction === "bad" ? "má" : "boa"} fase`;
    case "rotation":
      return `${team} deve poupar titulares`;
    case "stakes":
      return `jogo ${c.direction === "bad" ? "sem peso" : "decisivo"} ${forTeam}`;
    case "other":
      if (c.otherKind) return otherKindLine(c.otherKind, c.team, teams);
      return c.team === "both" ? "outra informação sobre o jogo" : `outra informação sobre o ${team}`;
  }
}

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
