import { bttsRule } from "@/lib/settlement/rules/btts";
import { matchResultRule } from "@/lib/settlement/rules/match_result";
import { overUnderRule } from "@/lib/settlement/rules/over_under";
import type { ResultData, SettlementOutcome } from "@/lib/settlement/schemas";

// Uma regra de settlement: pura, sem I/O. Recebe a seleção escolhida (key
// genérica de market_selections), os params crus do mercado (jsonb não
// confiável, validado DENTRO da regra) e o fato do jogo, e devolve o resultado
// largo (SettlementOutcome). Pode lançar SettlementError em params inválidos.
export type SettlementRule = (
  selection: string,
  marketParams: unknown,
  resultData: ResultData,
) => SettlementOutcome;

// O único `if (market === X)` permitido vive aqui: o mapa rule_key → regra. Novo
// mercado entra adicionando uma entrada (settlement_rule_key em markets resolve
// por aqui), sem tocar o dispatcher.
const REGISTRY: Record<string, SettlementRule> = {
  over_under: overUnderRule,
  match_result: matchResultRule,
  btts: bttsRule,
};

/**
 * Resolve a regra pura pra um settlement_rule_key. Lança Error puro em chave
 * desconhecida (espelha getCartridge) — settle.ts captura e nunca deixa uma row
 * com mercado desconhecido abortar o batch.
 */
export function getSettlementRule(ruleKey: string): SettlementRule {
  const rule = REGISTRY[ruleKey];
  if (!rule) {
    throw new Error(`unknown settlement rule key: ${ruleKey}`);
  }
  return rule;
}
