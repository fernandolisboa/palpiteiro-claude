import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { isNeutralVenue } from "@/lib/providers/sports-data/neutral-venue";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import { inPlayScoreline, type InPlayScoreline } from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { getMatchModelScoreline } from "@/lib/model-base/model-scoreline";
import { getModelScoreline } from "@/lib/ratings/model-scoreline";

// Porta ÚNICA do modelo de placar das apostas do usuário (cupom, aposta em texto e a
// grade de mercados). Primeiro a base do jogo (ADR 0052, #560): o λ do cron, pós-JEV
// quando aplicado, sem buscar tabela nem ratings. Sem base fresca (jogo novo, cron
// parado, versão antiga) cai no MESMO getModelScoreline da análise (Dixon-Coles com o
// heurístico da tabela como rede, #547).

export type SlipModelMatch = {
  id: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  neutralVenue: boolean;
};

export type ResolveSlipModelOptions = {
  // Ler a base "no apito" (#591, PLAN-580 §6.1/R10): o modelo em jogo parte do MESMO
  // modelo que a página mostrava antes do apito. Passar o kickoff; a base é lida com
  // `now = asOf − 1 ms`, então a idade de 24h é medida no apito e o corte "jogo já
  // começou" não dispara. O fallback (cálculo na hora) segue com o fit de hoje.
  asOf?: Date;
};

/** O estado do jogo que o modelo em jogo consome (o InPlayState satisfaz). */
export type InPlaySlipState = {
  statusShort: string;
  elapsed: number | null;
  extra: number | null;
  score: { home: number; away: number } | null;
  red: { home: number; away: number } | null;
};

/**
 * Modelo em jogo das apostas ao vivo (#580, PLAN-580 §6.1): o MESMO modelo que a página
 * mostrava no apito (`asOf: kickoffAt`), condicionado ao placar e ao minuto do estado.
 * null sem modelo de pré-jogo, sem placar ou sem leitura (prorrogação, minuto
 * desconhecido, interrompido): o registro segue sem avaliação. Nunca lança.
 */
export async function resolveInPlaySlipModel(
  match: SlipModelMatch & { kickoffAt: Date },
  state: InPlaySlipState,
): Promise<InPlayScoreline | null> {
  if (state.score === null) return null;
  const pre = await resolveSlipModel(match, { asOf: match.kickoffAt });
  if (pre === null) return null;
  return inPlayScoreline(pre, {
    statusShort: state.statusShort,
    elapsed: state.elapsed,
    extra: state.extra,
    score: state.score,
    red: state.red,
  });
}

/**
 * λ + matriz do jogo: a base quando há (nunca lança), senão o cálculo na hora. Tabela que falha → só o DC; sem os dois → null (a perna fica
 * sem número). Nunca lança.
 */
export async function resolveSlipModel(
  match: SlipModelMatch,
  opts: ResolveSlipModelOptions = {},
): Promise<ModelScoreline | null> {
  const fromBase = opts.asOf
    ? await getMatchModelScoreline(match.id, new Date(opts.asOf.getTime() - 1))
    : await getMatchModelScoreline(match.id);
  if (fromBase) return fromBase;
  let standing: NormalizedStanding | undefined;
  try {
    standing = await getSportsDataProvider().getStandings(match.league);
  } catch {
    standing = undefined;
  }
  try {
    return await getModelScoreline({
      league: match.league,
      standing,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      neutral: isNeutralVenue(match),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "slip_model",
        error: "model_failed",
        matchId: match.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}
