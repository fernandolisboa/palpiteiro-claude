import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// {home, away} do palpite — inteiros >= 0. Distinto do correctScoreRule: SEM a
// grade 0-3, então um 4-1 liquida normalmente (ADR 0028 §3). Validado aqui como
// defense-in-depth — #315 já valida na escrita do params jsonb.
//
// EXPORTADO pra o boundary do parse da aposta livre (ADR 0036, Decisão 2b): a perna
// exact_score do slip REUSA este MESMO schema, garantindo que o shape do params
// gravado bate byte-a-byte com o que esta regra safeParse'a na liquidação — drift
// aqui deixaria a perna PENDING pra sempre via SettlementError.
export const ExactScoreParamsSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});

/**
 * Regra pura de placar exato de PALPITE (compare direto, SEM grade). "won" sse o
 * placar palpitado == placar de 90' (regulation), senão "lost". NUNCA void/push
 * (não há linha num palpite de placar — PLAN §1.4). Distinta de correctScoreRule:
 * sem o curto-circuito `homeScore>3 || awayScore>3 → lost` da grade 0-3, e NÃO
 * registrada no REGISTRY de valor (palpite tem seu próprio caminho — ADR 0028).
 *
 * Lança SettlementError em params/score inválidos → o orquestrador (§3.3) bucketa
 * em `errors` e deixa o palpite PENDING (precedente "prefer skip over silent wrong
 * settle"). Em operação normal o orquestrador já filtra !regulationScore → skipped
 * ANTES de chamar esta regra, então o throw de null-split é defense-in-depth (só
 * guarda resultData corrompido/backfilled).
 */
export function settleExactScorePalpite(
  params: unknown,
  resultData: PalpiteResultData
): "won" | "lost" {
  const parsed = ExactScoreParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid exact_score palpite params", {
      issues: parsed.error.issues,
    });
  }
  // Defense-in-depth: homeScore/awayScore vêm de resultDataFromRegulationScore →
  // sempre não-null no caminho ao vivo (o orquestrador já barrou !regulationScore).
  if (resultData.homeScore === null || resultData.awayScore === null) {
    throw new SettlementError("missing 90' split for exact_score palpite");
  }
  return parsed.data.home === resultData.homeScore &&
    parsed.data.away === resultData.awayScore
    ? "won"
    : "lost";
}
