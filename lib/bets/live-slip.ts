import type { BetLegParams } from "@/db/schema";
import { SLIP_TOTAL_LINES, type SlipGridKind } from "@/lib/bets/slip-markets";
import { isDecided } from "@/lib/quant/in-play";

// Regras PURAS de Suas apostas ao vivo (#580, PLAN-580 §9.2/§6.5). Ao vivo só entram os
// tipos da tabela de mercados, que leem a matriz do placar FINAL: 1X2, dupla chance,
// ambas marcam, total de gols 1,5/2,5/3,5 e placar exato. Ficam de fora em especial o 1º
// tempo e "quem marca primeiro", que `priceLeg` recalcula do λ (errado em jogo), e o
// resto que o modelo não precifica (cartões, escanteios, margem, clean sheet). Seleção
// que o placar atual já decidiu é recusada (predicado sobre o placar, `isDecided`).

export const LIVE_DECIDED_COPY = "Esse mercado já está decidido.";
export const LIVE_KIND_COPY =
  "Com o jogo rolando, dá pra registrar só resultado, dupla chance, ambas marcam, total de gols (1,5, 2,5 ou 3,5) e placar exato.";

const LIVE_KINDS: ReadonlySet<string> = new Set<SlipGridKind>([
  "match_result",
  "double_chance",
  "btts",
  "over_under",
  "exact_score",
]);

/** O tipo (e a linha, no total de gols) é um dos que a tabela ao vivo oferece. */
export function isLiveSlipKind(kind: string, params: BetLegParams): boolean {
  if (!LIVE_KINDS.has(kind)) return false;
  if (kind !== "over_under") return true;
  const line = Number((params as Record<string, unknown>).line);
  return (SLIP_TOTAL_LINES as readonly number[]).includes(line);
}

/**
 * Por que o registro ao vivo dessas pernas é recusado, ou null quando todas valem. Tipo
 * fora da tabela vence (é a regra mais ampla); depois, a primeira perna já decidida.
 */
export function liveSlipRefusal(
  legs: ReadonlyArray<{ kind: string; params: BetLegParams }>,
  score: { home: number; away: number }
): string | null {
  if (legs.some((l) => !isLiveSlipKind(l.kind, l.params))) return LIVE_KIND_COPY;
  if (
    legs.some((l) =>
      isDecided(l.kind, l.params as Record<string, unknown>, score)
    )
  ) {
    return LIVE_DECIDED_COPY;
  }
  return null;
}
