import { getDescriptor } from "@/lib/odds/market-descriptor";

import { predict, type PredictResult } from "./predict";
import type { AIModelId } from "./models";

// Modo "melhor aposta do jogo" (#178): orquestração EM CÓDIGO do fan-out
// cross-mercado. Roda N análises (uma por mercado candidato) pro MESMO jogo, cada
// uma pela porta normal `predict()` (logada em ai_calls, criando sua predição). NUNCA
// chama o Anthropic SDK direto — predict() é a única porta pro LLM.

// Teto de chamadas de LLM por run (custo: cada predict() é dinheiro real). 6 dá
// folga real sobre a topologia de hoje (4 mercados no world_cup) — não é dead code
// que encaixa exato, e um 5º mercado graduado no futuro não derruba um Tier-1 sob o
// cap. Pinado por teste.
export const MAX_FANOUT_MARKETS = 6;

// Teto de buscas de odds *additional* por run (cada uma = 1 getOddsForEvent ≈ 1
// crédito da The Odds API, ~420/500 restando). Explícito em vez de consequência
// incidental do cap de LLM. Pinado por teste.
export const MAX_ADDITIONAL_FETCHES = 4;

export type FanOutMarket = { marketKey: string; extraLines: boolean };

export type FanOutOutcome =
  | { ok: true; marketKey: string; result: PredictResult }
  | { ok: false; marketKey: string; message: string };

/**
 * Aplica o cap retendo SEMPRE os mercados Tier-1 (cobertura universal:
 * `descriptor.coveredLeagues === undefined` — over/under + 1X2). Data-driven (sem
 * literal de mercado): se um 5º mercado for graduado/coberto no futuro e estourar o
 * cap, o slice determina que NUNCA derrube over/under-2.5 ou 1X2 (regressão de
 * paridade). Quando `candidates.length <= max` retorna como-está (ordem
 * determinística de `marketsForAudience` preservada — base de ordenação da view).
 */
export function capCandidates<T extends { key: string }>(
  candidates: T[],
  max: number,
): T[] {
  if (candidates.length <= max) return candidates;
  const isTier1 = (key: string): boolean => {
    const d = getDescriptor(key);
    return d !== undefined && d.coveredLeagues === undefined;
  };
  const tier1 = candidates.filter((c) => isTier1(c.key));
  const rest = candidates.filter((c) => !isTier1(c.key));
  return [...tier1, ...rest].slice(0, max);
}

/**
 * Fan-out SERIAL: um `predict()` por candidato, em ordem, best-of-successful.
 *
 * Serial (NÃO Promise.all) é deliberado: neon-http não tem `db.transaction` e o
 * `db.batch` não carrega um id de `.returning()` — predict() roda ~10 statements
 * sequenciais; N predict() em paralelo só multiplica round-trips HTTP sem ganho de
 * atomicidade e arrisca contenção de cold-start. Serial também faz o cap virar teto
 * real de spend concorrente, e o cache in-memory de odds (featured da liga) só ajuda.
 *
 * NUNCA propaga erro de um mercado: TODO erro (PredictError OU inesperado) é
 * capturado por-mercado, pra um irmão já pago/persistido (mercados 1..k-1) nunca ser
 * descartado por uma falha no mercado k. `mapError` (server-side friendlyMessage) é
 * injetado pra a mensagem amigável não vazar pro bundle do cliente.
 */
export async function runFanOut(
  base: {
    matchId: string;
    userId: string;
    isAdmin: boolean;
    modelOverride?: AIModelId;
  },
  markets: FanOutMarket[],
  mapError: (err: unknown) => string,
): Promise<FanOutOutcome[]> {
  const out: FanOutOutcome[] = [];
  for (const m of markets) {
    try {
      const result = await predict({
        ...base,
        marketKey: m.marketKey,
        extraLines: m.extraLines,
      });
      out.push({ ok: true, marketKey: m.marketKey, result });
    } catch (err) {
      out.push({ ok: false, marketKey: m.marketKey, message: mapError(err) });
    }
  }
  return out;
}
