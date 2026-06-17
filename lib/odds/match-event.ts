import { teamsMatch } from "@/lib/odds/market-descriptor";

// Janela de pareamento kickoff↔evento (±6h): tolera fuso/atraso de agenda sem
// casar um jogo errado da mesma dupla de times.
export const KICKOFF_PAIRING_WINDOW_MS = 6 * 60 * 60 * 1000;

type EventLike = {
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
};

type MatchLike = {
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

/**
 * Pareia um evento do provider contra um match do DB pela dupla de times
 * (`teamsMatch`) dentro da janela de kickoff. ESTRUTURAL de propósito: aceita
 * tanto a lista GRATUITA de eventos (`NormalizedOddsEventListItem`, sem
 * `bookmakers`) quanto o payload de odds (`NormalizedOddsEvent`, com
 * `bookmakers`) — só lê commenceTime/times. Fonte única do pareamento (espelha
 * `teamsMatch` em market-descriptor.ts), reusada pelo caminho featured (batch) E
 * pelo additional (por evento) em fetch-and-snapshot.
 */
export function findEventInList<T extends EventLike>(
  events: readonly T[],
  match: MatchLike,
): T | undefined {
  const kickoffMs = match.kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commenceTime);
    if (
      !Number.isFinite(ts) ||
      Math.abs(ts - kickoffMs) > KICKOFF_PAIRING_WINDOW_MS
    ) {
      return false;
    }
    return (
      teamsMatch(event.homeTeam, match.homeTeam) &&
      teamsMatch(event.awayTeam, match.awayTeam)
    );
  });
}
