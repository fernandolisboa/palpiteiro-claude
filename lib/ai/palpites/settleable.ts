// `settleable` é DERIVADO do `type` da linha de palpite — NUNCA lido do output do
// LLM (constraint do #315 / ADR 0028 §3). Fonte ÚNICA da verdade: a tupla
// `SETTLEABLE_PALPITE_TYPES` dirige AMBOS os caminhos — `deriveSettleable` (boundary
// de escrita) e o predicado SQL da pending query (`inArray(palpites.type, …)`,
// lib/db/queries/palpites.ts) — defense-in-depth contra um seed errado / drift.
// `red_card`/`corners` ficam FORA da tupla → continuam settleable=false, nunca entram
// no cron (gate Tier-3 de pé, ADR 0028). Os tipos goal-derived (#354) liquidam do
// placar de 90'/intervalo/eventos, sem provider novo.
import type { palpiteTypeEnum } from "@/db/schema";

export type PalpiteType = (typeof palpiteTypeEnum.enumValues)[number];

// Tupla readonly — fonte única do gate. `satisfies readonly PalpiteType[]` garante em
// compile-time que só contém valores válidos do enum (um typo vira erro de tipo).
export const SETTLEABLE_PALPITE_TYPES = [
  "exact_score",
  "margin",
  "clean_sheet",
  "first_half_score",
  "first_to_score",
] as const satisfies readonly PalpiteType[];

// O subconjunto settleable do enum, como union literal. O dispatch de settlement
// (palpite-dispatch.ts) é chaveado por este tipo.
export type SettleablePalpiteType = (typeof SETTLEABLE_PALPITE_TYPES)[number];

const SETTLEABLE_SET: ReadonlySet<PalpiteType> = new Set(SETTLEABLE_PALPITE_TYPES);

export function deriveSettleable(type: PalpiteType): boolean {
  return SETTLEABLE_SET.has(type);
}
