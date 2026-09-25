import { getDescriptor } from "@/lib/odds/market-descriptor";
import { computeBestBetRank } from "@/lib/view/best-bet";
import { sortBestBetEntries } from "@/lib/view/best-bet-sort";

import { isCodeJevMarket } from "./engine/code-jev";
import { getCartridge } from "./markets/registry";
import {
  narratePendingPrediction,
  persistPendingPrediction,
  predict,
  predictForBestBet,
  type CodeJevRunMemo,
  type PendingCodeJevPrediction,
  type PredictResult,
} from "./predict";
import type { AIModelId } from "./models";

// Modo "melhor aposta do jogo" (#178): orquestração EM CÓDIGO do fan-out
// cross-mercado. Roda N análises (uma por mercado candidato) pro MESMO jogo, cada
// uma pela porta normal `predict()` (logada em ai_calls, criando sua predição). NUNCA
// chama o Anthropic SDK direto — predict() é a única porta pro LLM.

// Teto de chamadas de LLM por run (custo: cada predict() é dinheiro real). 7 = o
// maior conjunto de hoje: admin no Brasileirão (over/under, 1X2, btts, dupla chance,
// placar exato, artilheiro, assistência). Com 6, `capCandidates` cortava a dupla
// chance (última na ordem alfabética) em silêncio. Usuário comum vê ≤4 (graduados);
// um mercado novo acima disso ainda nunca derruba um Tier-1 sob o cap. Pinado por teste.
export const MAX_FANOUT_MARKETS = 7;

// Teto de buscas de odds *additional* por run (cada uma = 1 getOddsForEvent ≈ 1
// crédito da The Odds API, ~420/500 restando). Explícito em vez de consequência
// incidental do cap de LLM. Pinado por teste.
export const MAX_ADDITIONAL_FETCHES = 4;

export type FanOutMarket = { marketKey: string; extraLines: boolean };

export type FanOutOutcome =
  | {
      ok: true;
      marketKey: string;
      result: PredictResult;
      // Best bet code_jev (#512): mercado não narrado — racional templado, a
      // prediction aponta pra row de ai_calls da narração do run (custo de outro
      // card). Ausente = a análise tem a própria chamada.
      sharesAiCall?: true;
    }
  | { ok: false; marketKey: string; message: string };

// Mensagem de um mercado sem slot de rate-limit (#492) — a mesma da cauda não
// concedida no analyzeBestBet.
export const RATE_LIMITED_MARKET_MESSAGE =
  "Limite diário atingido — não analisado.";

// Limiter indisponível (KV ausente p/ não-admin, fail-closed): a mesma copy do
// analyzeBestBet quando isso acontece antes do run.
export const ANALYSES_UNAVAILABLE_MESSAGE =
  "Análises temporariamente indisponíveis. Tente mais tarde.";

// Resultado de um pedido de slot no meio do run (o RateLimitResult do caller).
export type SlotGrant = { ok: boolean; reason?: "fail-closed" };

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

// ─── Motor code_jev (ADR 0041 §4, #512) ──────────────────────────────────────

type FanOutBase = Parameters<typeof runFanOut>[0];

/**
 * Mercado que o motor code_jev decide em código (partition precificável pela
 * matriz de placar), no cartucho EFETIVO (extraLines). Os demais (placar exato,
 * scorer, assist) seguem no caminho LLM, uma chamada paga cada.
 */
export function isCodeJevFanOutMarket(m: FanOutMarket): boolean {
  return isCodeJevMarket(
    getCartridge(m.marketKey, { extraLines: m.extraLines }).descriptor,
  );
}

/**
 * Unidades de cobrança de rate-limit (1 slot = 1 chamada paga, #492/#512): cada
 * item é a própria unidade, exceto os `grouped`, que formam UMA unidade na posição
 * do 1º deles (ordem preservada). Sem agrupados = um item por unidade (o fan-out
 * de hoje).
 */
export function groupSlotUnits<T>(
  items: readonly T[],
  grouped: (item: T) => boolean,
): T[][] {
  const units: T[][] = [];
  let group: T[] | null = null;
  for (const item of items) {
    if (!grouped(item)) {
      units.push([item]);
    } else if (group) {
      group.push(item);
    } else {
      group = [item];
      units.push(group);
    }
  }
  return units;
}

// Slot de rate-limit negado no meio do run: o mercado vira "não analisado" (ou
// "indisponível" no fail-closed), sem gasto.
class SlotDeniedError extends Error {
  readonly failClosed: boolean;
  constructor(failClosed: boolean) {
    super("daily analysis slot denied");
    this.name = "SlotDeniedError";
    this.failClosed = failClosed;
  }
}

/**
 * Best bet no motor code_jev (ADR 0041 §4): 1 chamada JEV por jogo, TODOS os
 * mercados code_jev decididos em código a partir da mesma matriz, e o narrador LLM
 * SÓ no mercado escolhido — o card do topo do painel (mesma ordenação, modo default
 * "edge"). Os demais persistem com o racional templado (zero custo), apontando pra
 * row de ai_calls da narração. Mercados fora do code_jev rodam o predict de sempre.
 *
 * Rate-limit (#492/#493): o caller cobra 1 slot pelo GRUPO code_jev (a narração) +
 * 1 por mercado fora dele, antes do run. Toda chamada paga EXTRA do grupo — um
 * mercado que cai no caminho LLM porque o λ faltou — pede o próprio slot via
 * `acquireSlot` ANTES do gasto; o 1º a precisar usa o slot do grupo. Slots cobrados
 * == chamadas pagas: nem 6 slots por 1 chamada, nem chamada sem slot.
 *
 * Serial como runFanOut, e o mesmo contrato best-of-successful: erro de um mercado
 * nunca derruba os irmãos.
 */
export async function runCodeJevFanOut(
  base: FanOutBase,
  markets: FanOutMarket[],
  mapError: (err: unknown) => string,
  acquireSlot: () => Promise<SlotGrant>,
): Promise<FanOutOutcome[]> {
  // Na ordem dos mercados; null = decisão pendente até a fase de narração.
  const out: (FanOutOutcome | null)[] = [];
  const fail = (marketKey: string, err: unknown): FanOutOutcome => ({
    ok: false,
    marketKey,
    message:
      err instanceof SlotDeniedError
        ? err.failClosed
          ? ANALYSES_UNAVAILABLE_MESSAGE
          : RATE_LIMITED_MARKET_MESSAGE
        : mapError(err),
  });

  let groupSlotFree = markets.some(isCodeJevFanOutMarket);
  const takeSlot = async (): Promise<void> => {
    if (groupSlotFree) {
      groupSlotFree = false;
      return;
    }
    const grant = await acquireSlot();
    if (!grant.ok) throw new SlotDeniedError(grant.reason === "fail-closed");
  };

  // λ + JEV fixados no 1º mercado code_jev: 1 chamada JEV e 1 matriz por run.
  const runMemo: CodeJevRunMemo = new Map();
  const pendings: { index: number; pending: PendingCodeJevPrediction }[] = [];
  for (const m of markets) {
    const args = { ...base, marketKey: m.marketKey, extraLines: m.extraLines };
    try {
      if (!isCodeJevFanOutMarket(m)) {
        out.push({ ok: true, marketKey: m.marketKey, result: await predict(args) });
        continue;
      }
      const outcome = await predictForBestBet(args, {
        engine: "code_jev",
        runMemo,
        beforeLlmPath: takeSlot,
      });
      if (outcome.kind === "done") {
        out.push({ ok: true, marketKey: m.marketKey, result: outcome.result });
      } else {
        pendings.push({ index: out.length, pending: outcome.pending });
        out.push(null);
      }
    } catch (err) {
      out.push(fail(m.marketKey, err));
    }
  }
  const settled = (): FanOutOutcome[] =>
    out.filter((o): o is FanOutOutcome => o !== null);
  if (pendings.length === 0) return settled();

  const [chosen, ...others] = sortBestBetEntries(
    pendings.map((p) => ({
      marketKey: p.pending.marketKey,
      rank: computeBestBetRank(
        p.pending.rankInput,
        p.pending.marketKey,
        p.pending.rankInput.selections,
      ),
      p,
    })),
    "edge",
  ).map((e) => e.p);

  let narration: Awaited<ReturnType<typeof narratePendingPrediction>>;
  try {
    await takeSlot();
    narration = await narratePendingPrediction(chosen.pending);
  } catch (err) {
    // Sem a row da narração não há ai_call pra referenciar: nenhum pendente persiste.
    for (const p of pendings) out[p.index] = fail(p.pending.marketKey, err);
    return settled();
  }

  // O escolhido persiste primeiro. Se só ELE falhar, os irmãos ainda persistem como
  // templados ($0) e a narração paga não aparece em card nenhum — aceito: o custo
  // segue em ai_calls (relatórios de custo), o mercado escolhido aparece como falha
  // na view e o caso (insert de prediction falhando logo após o de ai_calls) é raro.
  // Promover o 2º colocado a "dono" da chamada misturaria o texto de um mercado
  // com a row de outro.
  for (const p of [chosen, ...others]) {
    const isChosen = p === chosen;
    try {
      const result = await persistPendingPrediction(p.pending, {
        aiCallId: narration.aiCallId,
        narration: isChosen ? narration.output : undefined,
      });
      out[p.index] = isChosen
        ? { ok: true, marketKey: p.pending.marketKey, result }
        : { ok: true, marketKey: p.pending.marketKey, result, sharesAiCall: true };
    } catch (err) {
      out[p.index] = fail(p.pending.marketKey, err);
    }
  }
  return settled();
}
