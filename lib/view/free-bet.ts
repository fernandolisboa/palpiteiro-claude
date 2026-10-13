// Rótulos PUROS das pernas de aposta do usuário (ADR 0036): a aposta em texto e o
// histórico /apostas. Sem DB/IO — importável de qualquer lado.

export const SETTLE_BADGE_PT_BR = "conferimos após o jogo";

// Rótulo de placar exato pra a perna (pura, sem provider). "Placar exato: 2 a 0".
export function exactScoreLabel(home: number, away: number): string {
  return `Placar exato: ${home} a ${away}`;
}

// Rótulo humano PT-BR de QUALQUER perna (pura — usa "mandante"/"visitante", sem nome
// de time). Fase 2: todos os kinds.
const sideLabel = (s: string) => (s === "home" ? "Mandante" : "Visitante");
const overUnder = (s: string) => (s === "over" ? "Mais" : "Menos");

export function betLegLabel(
  kind: string,
  params: Record<string, unknown>,
): string {
  switch (kind) {
    case "exact_score":
      return exactScoreLabel(Number(params.home), Number(params.away));
    case "first_half_score":
      return `Placar do 1º tempo: ${params.home} a ${params.away}`;
    case "margin":
      return `${sideLabel(String(params.side))} vence por ${params.minMargin}+ gol(s)`;
    case "clean_sheet":
      return `${sideLabel(String(params.side))} não sofre gol`;
    case "first_to_score":
      return params.firstToScore === "none"
        ? "Nenhum time marca"
        : `${sideLabel(String(params.firstToScore))} marca primeiro`;
    case "over_under":
      return `${overUnder(String(params.selection))} de ${params.line} gols`;
    case "first_half_over_under":
      return `1º tempo: ${overUnder(String(params.selection))} de ${params.line} gols`;
    case "match_result":
      return params.selection === "home"
        ? "Vitória do mandante"
        : params.selection === "away"
          ? "Vitória do visitante"
          : "Empate";
    case "btts":
      return params.selection === "yes"
        ? "Ambos os times marcam"
        : "Não saem gols dos dois lados";
    case "double_chance":
      return params.selection === "home_draw"
        ? "Mandante ou empate"
        : params.selection === "home_away"
          ? "Mandante ou visitante"
          : "Empate ou visitante";
    case "cards":
      return `${overUnder(String(params.selection))} de ${params.line} cartões`;
    case "corners":
      return `${overUnder(String(params.selection))} de ${params.line} escanteios`;
    default:
      return kind;
  }
}
