import type { BetLegParams } from "@/db/schema";
import {
  COUNTDOWN_WINDOW_MS,
  LEAGUE_LABEL,
  formatKickoffDateTime,
  formatLine,
  formatStartsIn,
  leagueToKey,
} from "@/lib/format";
import { poolBetsOpen } from "@/lib/pools/pool-state";
import { resolvePoolScore } from "@/lib/pools/winners";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { displayMatchTeams } from "@/lib/view/team";

// Rótulos do bolão entre amigos (#567). Puros e serializáveis.

export const POOL_MONEY_NOTE =
  "O Palpiteiro só anota as apostas e faz a conta. Não recebe, não guarda e não repassa dinheiro: o acerto é entre vocês.";

// Aviso de risco (ADR 0048 §4), VERBATIM o das outras telas de aposta
// (lib/view/bet-slip.ts, app/(app)/apostas/page.tsx). Constante local de propósito: a
// tela do bolão não arrasta o grafo de import do cupom.
export const POOL_RISK_NOTE =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

type TeamNames = { home: string; away: string };

function lineLabel(line: unknown): string {
  return typeof line === "number" || typeof line === "string" ? formatLine(line) : String(line);
}

/** "Flamengo 2 × 1 Palmeiras", "Vitória do Flamengo", "Mais de 2,5 gols"… */
export function poolBetLabel(kind: string, params: BetLegParams, teams: TeamNames): string {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "exact_score":
      return `${teams.home} ${p.home} × ${p.away} ${teams.away}`;
    case "match_result":
      return p.selection === "home"
        ? `Vitória do ${teams.home}`
        : p.selection === "away"
          ? `Vitória do ${teams.away}`
          : "Empate";
    case "double_chance":
      return p.selection === "home_draw"
        ? `${teams.home} ou empate`
        : p.selection === "home_away"
          ? `${teams.home} ou ${teams.away}`
          : `Empate ou ${teams.away}`;
    case "btts":
      return p.selection === "yes" ? "Os dois times marcam" : "Pelo menos um time não marca";
    case "over_under":
      return `${p.selection === "over" ? "Mais" : "Menos"} de ${lineLabel(p.line)} gols`;
    default:
      return kind;
  }
}

/**
 * A aposta na lista de apostadores (#577): o placar com as siglas ("PAL 2 × 1 FLA",
 * de `teamPair`, que desempata siglas iguais) pra caber numa linha com o tipo; os
 * outros tipos ficam com o rótulo de `poolBetLabel` e o nome curto.
 */
export function poolBetShortLabel(
  kind: string,
  params: BetLegParams,
  teams: TeamNames,
  codes: TeamNames,
): string {
  if (kind === "exact_score") {
    const p = params as Record<string, unknown>;
    return `${codes.home} ${p.home} × ${p.away} ${codes.away}`;
  }
  return poolBetLabel(kind, params, teams);
}

export type PoolStatusTone = "open" | "soon" | "neutral";
export type PoolStatusView = { label: string; tone: PoolStatusTone };

/**
 * Selo do bolão na lista (#577). Aberto em destaque; nas últimas 3h antes do apito
 * (a trava), âmbar com quanto falta. Sem a hora no selo: a linha do bolão já mostra
 * data e hora do jogo. Placar, adiado, cancelado e "esperando o placar" ficam
 * neutros. Delta puro: não depende de fuso.
 */
export function poolStatusView(
  row: {
    pool: { manualHomeScore: number | null; manualAwayScore: number | null };
    match: {
      status: string;
      kickoffAt: Date;
      homeScore: number | null;
      awayScore: number | null;
    };
  },
  now: Date,
): PoolStatusView {
  const score = resolvePoolScore(row.pool, row.match);
  if (score) return { label: `placar ${score.home} × ${score.away}`, tone: "neutral" };
  if (row.match.status === "postponed") return { label: "jogo adiado", tone: "neutral" };
  if (row.match.status === "cancelled") return { label: "jogo cancelado", tone: "neutral" };
  if (poolBetsOpen(row.match, now)) {
    const closesIn = poolClosesIn(row.match.kickoffAt, now);
    return closesIn
      ? { label: `fecham ${closesIn}`, tone: "soon" }
      : { label: "apostas abertas", tone: "open" };
  }
  return { label: "esperando o placar", tone: "neutral" };
}

/** "em 2h 10min" só nas últimas 3h antes do apito (a trava do bolão); senão undefined. */
export function poolClosesIn(kickoffAt: Date, now: Date): string | undefined {
  return formatStartsIn(kickoffAt, now, COUNTDOWN_WINDOW_MS);
}

/** Tipo da aposta, pra coluna curta da tabela. */
export const POOL_KIND_LABEL: Record<string, string> = {
  exact_score: "Placar",
  match_result: "Resultado",
  double_chance: "Dupla chance",
  btts: "Ambos marcam",
  over_under: "Gols",
};

/** "Flamengo × Palmeiras · Brasileirão · sáb, 18 out, 16:00". */
export function poolMatchLabel(
  match: { homeTeam: string; awayTeam: string; league: SupportedLeague; kickoffAt: Date },
  now: Date,
  timeZone?: string,
): string {
  const league = leagueToKey(match.league);
  const teams = displayMatchTeams(match.homeTeam, match.awayTeam, league);
  return [
    `${teams.home} × ${teams.away}`,
    LEAGUE_LABEL[league],
    formatKickoffDateTime(match.kickoffAt, now, timeZone),
  ].join(" · ");
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e Caio". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
