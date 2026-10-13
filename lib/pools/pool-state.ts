import { matchUnavailableReason } from "@/lib/view/match-availability";

// Estado do bolão derivado do jogo (#567). Mesmo gate de "pré-jogo" da análise e do
// registro de apostas: `scheduled` e kickoff no futuro.

/** Apostas abertas = o jogo ainda não começou. */
export function poolBetsOpen(
  match: { status: string; kickoffAt: Date },
  now: Date = new Date(),
): boolean {
  return matchUnavailableReason(match.status, match.kickoffAt, now) === null;
}
