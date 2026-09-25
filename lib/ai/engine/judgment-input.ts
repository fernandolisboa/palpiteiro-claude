import {
  enrichAbsences,
  tableInputForLeague,
  type JudgmentAbsenceInput,
  type JudgmentStateInput,
} from "@/lib/ai/judgments/state";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  NormalizedFixture,
  NormalizedInjury,
  NormalizedLineup,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

// Monta o input do state JEV (ADR 0041 §2) SÓ com o que o predict já buscou — zero
// chamada nova de provider. O que não temos (próximo jogo, artilheiros) fica
// ausente e vira "unknown" no state.

// Rótulo em inglês da competição (o state do JEV é em inglês).
const COMPETITION_LABEL: Record<SupportedLeague, string> = {
  brasileirao_a: "Brazilian Serie A",
  champions_league: "UEFA Champions League",
  world_cup: "FIFA World Cup",
  serie_a: "Italian Serie A",
  bundesliga: "German Bundesliga",
  ligue_1: "French Ligue 1",
  copa_libertadores: "Copa Libertadores",
  copa_sudamericana: "Copa Sudamericana",
  premier_league: "English Premier League",
  la_liga: "Spanish La Liga",
};

// Último jogo do time ANTES deste (a forma recente vem do provider, já ordenada ou
// não — ordenamos aqui). Comparação de datas no código, nunca no JEV.
function previousKickoffAt(
  form: readonly NormalizedFixture[],
  kickoffMs: number
): string | undefined {
  let best: NormalizedFixture | undefined;
  for (const f of form) {
    if (f.kickoffTimestampMs >= kickoffMs) continue;
    if (!best || f.kickoffTimestampMs > best.kickoffTimestampMs) best = f;
  }
  return best?.kickoffAt;
}

export type MatchJudgmentData = {
  league: SupportedLeague;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  injuries: { home: NormalizedInjury[]; away: NormalizedInjury[] };
  lineups: NormalizedLineup | undefined;
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  standings: NormalizedStanding | undefined;
};

export type MatchJudgmentInput = {
  stateInput: JudgmentStateInput;
  // Desfalques enriquecidos com papel — reusados pelo narrador (papel, não nome).
  absences: { home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] };
};

export function buildMatchJudgmentInput(
  data: MatchJudgmentData
): MatchJudgmentInput {
  const kickoffMs = data.kickoffAt.getTime();
  const absences = {
    home: enrichAbsences(data.injuries.home, {
      lastLineup: data.lineups?.home,
    }),
    away: enrichAbsences(data.injuries.away, {
      lastLineup: data.lineups?.away,
    }),
  };
  return {
    absences,
    stateInput: {
      competition: COMPETITION_LABEL[data.league],
      kickoffAt: data.kickoffAt.toISOString(),
      home: {
        name: data.homeTeam,
        absences: absences.home,
        previousKickoffAt: previousKickoffAt(data.homeForm, kickoffMs),
      },
      away: {
        name: data.awayTeam,
        absences: absences.away,
        previousKickoffAt: previousKickoffAt(data.awayForm, kickoffMs),
      },
      table: tableInputForLeague(data.league, data.standings),
    },
  };
}
