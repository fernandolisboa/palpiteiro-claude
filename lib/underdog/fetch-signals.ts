import { getAbsencesProvider } from "@/lib/providers/absences";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { FixtureRef } from "@/lib/providers/sports-data/types";

import { FORM_LAST, H2H_LAST, SIGNALS_TIMEOUT_MS } from "./constants";
import { dataSignals } from "./signals";
import type { UnderdogSide, UnderdogSignal } from "./types";

// Busca dos sinais de dado do painel do azarão (#671): forma e confronto direto pela
// SportsDataProvider com cache (a mesma da aba Dados) e desfalques pela cascata
// dedicada (ADR 0026). Nunca a The Odds API nem busca na web. Cada fonte tem prazo duro
// e degrada sozinha (o sinal some). Nunca lança.

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    ),
  ]);
}

export async function fetchUnderdogSignals(args: {
  match: {
    league: SupportedLeague;
    kickoffAt: Date;
    homeTeam: string;
    awayTeam: string;
  };
  side: UnderdogSide;
  timeoutMs?: number;
}): Promise<UnderdogSignal[]> {
  const { match } = args;
  const ms = args.timeoutMs ?? SIGNALS_TIMEOUT_MS;
  try {
    const provider = getSportsDataProvider();
    const ref: FixtureRef = {
      league: match.league,
      kickoffAt: match.kickoffAt.toISOString(),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    };
    const [homeForm, awayForm, h2h, absences] = await Promise.allSettled([
      within(provider.getTeamForm(match.homeTeam, match.league, FORM_LAST), ms),
      within(provider.getTeamForm(match.awayTeam, match.league, FORM_LAST), ms),
      within(
        provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
        ms
      ),
      within(getAbsencesProvider().getAbsencesByFixture(ref), ms),
    ]);
    const failed = [homeForm, awayForm, h2h, absences].filter(
      (r) => r.status === "rejected"
    );
    if (failed.length > 0) {
      console.warn(
        JSON.stringify({
          scope: "underdog",
          event: "signals_partial",
          failed: failed.length,
        })
      );
    }
    return dataSignals({
      side: args.side,
      teams: { home: match.homeTeam, away: match.awayTeam },
      form:
        homeForm.status === "fulfilled" && awayForm.status === "fulfilled"
          ? { home: homeForm.value, away: awayForm.value }
          : null,
      h2h: h2h.status === "fulfilled" ? h2h.value : null,
      absences:
        absences.status === "fulfilled"
          ? {
              home: absences.value.home.length,
              away: absences.value.away.length,
            }
          : null,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        error: "signals_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return [];
  }
}
