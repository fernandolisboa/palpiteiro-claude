import { getEnableDixonColes } from "@/lib/db/queries/ai-config";
import { getMatchRatings } from "@/lib/db/queries/team-ratings";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import {
  pickModelScoreline,
  type ModelScoreline,
  type PickModelScorelineInput,
} from "@/lib/quant/match-model";

// Fonte ÚNICA do λ + matriz de placar do predict (ADR 0051): Dixon-Coles dos ratings
// refitados todo dia, com o heurístico da tabela (ADR 0037) como rede. Nunca lança:
// qualquer falha de leitura cai no heurístico com fallbackReason "error".

export type ModelScorelineArgs = {
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  standing: NormalizedStanding | undefined;
  neutral: boolean;
};

// Flag memoizado por instância, como o analysis_engine: um flip no admin vale em até
// 60s, e o fan-out do best bet não faz uma query por mercado.
const FLAG_TTL_MS = 60 * 1000;
let flagMemo: { at: number; enabled: boolean } | null = null;

async function readDixonColesFlag(now: number): Promise<boolean> {
  if (flagMemo && now - flagMemo.at < FLAG_TTL_MS) return flagMemo.enabled;
  const enabled = await getEnableDixonColes();
  flagMemo = { at: now, enabled };
  return enabled;
}

/** Zera o memo do flag: testes e o flip no admin (mesma instância). */
export function resetDixonColesFlagMemo(): void {
  flagMemo = null;
}

async function readDc(
  args: ModelScorelineArgs,
  now: Date
): Promise<PickModelScorelineInput["dc"]> {
  try {
    if (!(await readDixonColesFlag(now.getTime()))) return null;
    return await getMatchRatings(args.league, args.homeTeam, args.awayTeam);
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "model_scoreline",
        error: "ratings_read_failed",
        league: args.league,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return { error: true };
  }
}

/**
 * λ + matriz do jogo. null = sem ratings utilizáveis E sem tabela (o motor code_jev
 * não precifica; o over/under roda sem âncora).
 */
export async function getModelScoreline(
  args: ModelScorelineArgs,
  now: Date = new Date()
): Promise<ModelScoreline | null> {
  const dc = await readDc(args, now);
  return pickModelScoreline({
    now,
    neutral: args.neutral,
    dc,
    heuristic: computeMatchLambdas({
      standing: args.standing,
      homeTeam: args.homeTeam,
      awayTeam: args.awayTeam,
      neutral: args.neutral,
    }),
  });
}
