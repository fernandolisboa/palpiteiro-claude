import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { isNeutralVenue } from "@/lib/providers/sports-data/neutral-venue";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { getModelScoreline } from "@/lib/ratings/model-scoreline";

// Porta ÚNICA do modelo de placar das apostas do usuário (cupom, aposta em texto e a
// grade de mercados). Hoje: o MESMO getModelScoreline da análise (Dixon-Coles com o
// heurístico da tabela como rede, #547). A Fase 1 (ADR 0052, base do modelo por jogo)
// troca o corpo por getMatchModelScoreline(match.id) com fallback pra este caminho
// quando o jogo ainda não tem snapshot — sem mexer em quem chama.

export type SlipModelMatch = {
  id: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  neutralVenue: boolean;
};

/**
 * λ + matriz do jogo. Tabela que falha → só o DC; sem os dois → null (a perna fica
 * sem número). Nunca lança.
 */
export async function resolveSlipModel(
  match: SlipModelMatch,
): Promise<ModelScoreline | null> {
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
