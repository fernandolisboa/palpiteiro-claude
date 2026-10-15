import type { BetLegParams } from "@/db/schema";
import { LEAGUE_LABEL, formatKickoffDateTime, formatLine, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

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
  return [
    `${match.homeTeam} × ${match.awayTeam}`,
    LEAGUE_LABEL[leagueToKey(match.league)],
    formatKickoffDateTime(match.kickoffAt, now, timeZone),
  ].join(" · ");
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e Caio". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
