import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { isNeutralVenue } from "@/lib/providers/sports-data/neutral-venue";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
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

/**
 * λ + matriz do jogo: a base quando há (nunca lança), senão o cálculo na hora. Tabela que falha → só o DC; sem os dois → null (a perna fica
 * sem número). Nunca lança.
 */
export async function resolveSlipModel(
  match: SlipModelMatch,
): Promise<ModelScoreline | null> {
  const fromBase = await getMatchModelScoreline(match.id);
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
