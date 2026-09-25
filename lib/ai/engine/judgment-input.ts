import { canonicalHash } from "@/lib/ai/judgments/state-hash";
import {
  buildJudgmentState,
  enrichAbsences,
  normalizePersonName,
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
  NormalizedTeamLineup,
} from "@/lib/providers/sports-data/types";

// Monta o input do state JEV (ADR 0041 §2) SÓ com o que o predict já buscou (a
// única busca extra, a escalação do jogo anterior de cada time, é do predict). O
// que não temos (próximo jogo, artilheiros) fica ausente e vira "unknown" no state.

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
export function previousFixture(
  form: readonly NormalizedFixture[],
  kickoffMs: number
): NormalizedFixture | undefined {
  let best: NormalizedFixture | undefined;
  for (const f of form) {
    if (f.kickoffTimestampMs >= kickoffMs) continue;
    if (!best || f.kickoffTimestampMs > best.kickoffTimestampMs) best = f;
  }
  return best;
}

export type MatchJudgmentData = {
  league: SupportedLeague;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  injuries: { home: NormalizedInjury[]; away: NormalizedInjury[] };
  // Escalação DESTE jogo: nunca traz quem está fora, então é só o fallback.
  lineups: NormalizedLineup | undefined;
  // Escalação de cada time no jogo ANTERIOR (a fonte certa de posição/titular do
  // desfalcado); ausente quando não buscada ou indisponível.
  previousLineups?: {
    home?: NormalizedTeamLineup;
    away?: NormalizedTeamLineup;
  };
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
      lastLineup: data.previousLineups?.home ?? data.lineups?.home,
    }),
    away: enrichAbsences(data.injuries.away, {
      lastLineup: data.previousLineups?.away ?? data.lineups?.away,
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
        previousKickoffAt: previousFixture(data.homeForm, kickoffMs)?.kickoffAt,
      },
      away: {
        name: data.awayTeam,
        absences: absences.away,
        previousKickoffAt: previousFixture(data.awayForm, kickoffMs)?.kickoffAt,
      },
      table: tableInputForLeague(data.league, data.standings),
    },
  };
}

// Impressão digital dos insumos do state JEV SEM a escalação do jogo anterior
// (#512): o state sem ela + quem está fora (nome normalizado, status, tipo) + o jogo
// anterior de cada time (de onde a escalação sairia). Mesma impressão ⇒ mesmo
// state final. Só vive em memória (memo do best bet): o nome entra no hash local,
// nunca no state enviado ao JEV nem no banco.
export function judgmentInputFingerprint(
  data: Omit<MatchJudgmentData, "previousLineups">
): string {
  const kickoffMs = data.kickoffAt.getTime();
  const { stateInput } = buildMatchJudgmentInput(data);
  const injured = (list: readonly NormalizedInjury[]) =>
    list
      .map((i) => `${normalizePersonName(i.player.name)}|${i.status}|${i.type}`)
      .sort();
  const previous = (form: readonly NormalizedFixture[]) => {
    const f = previousFixture(form, kickoffMs);
    return f ? `${f.league}|${f.kickoffAt}|${f.homeTeam}|${f.awayTeam}` : null;
  };
  return canonicalHash({
    state: buildJudgmentState(stateInput),
    injured: {
      home: injured(data.injuries.home),
      away: injured(data.injuries.away),
    },
    previous: { home: previous(data.homeForm), away: previous(data.awayForm) },
  });
}
