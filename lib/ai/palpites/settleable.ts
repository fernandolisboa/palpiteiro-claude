// `settleable` é DERIVADO do `type` da linha de palpite — NUNCA lido do output do
// LLM (constraint do #315 / ADR 0028 §3). Fonte ÚNICA da verdade: só `exact_score`
// é liquidado (badge acertou/errou); `red_card`/`corners` são diversão pura
// (settleable=false), nunca recebem outcome. O cron de placar usa o MESMO predicado
// (`type='exact_score'`, lib/db/queries/palpites.ts) — defense-in-depth contra um
// seed errado. Adicionar um tipo settleable novo é gate Tier 3 (exige ADR).
import type { palpiteTypeEnum } from "@/db/schema";

export type PalpiteType = (typeof palpiteTypeEnum.enumValues)[number];

export function deriveSettleable(type: PalpiteType): boolean {
  return type === "exact_score";
}
