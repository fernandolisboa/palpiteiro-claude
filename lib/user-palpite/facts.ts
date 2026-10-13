import { enrichAbsences } from "@/lib/ai/judgments/state";
import type { DbMatch } from "@/lib/db/queries/matches";
import { getAbsencesProvider } from "@/lib/providers/absences";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { FixtureRef } from "@/lib/providers/sports-data/types";

import type { Availability, PalpiteFacts } from "./check-claims";

// Fatos pra conferir as afirmações do "Seu palpite" (#564, ADR 0054). Só o que as
// afirmações citam (factsNeeded): zero afirmações = zero chamadas. Cada busca tem o seu
// teto de tempo e falha sozinha (allSettled). Qualquer erro vira "indisponível", nunca
// lista vazia: aqui um vazio confirmaria "time completo" em falso. Isso difere de
// propósito do predict, que trata desfalque indisponível como lista vazia no state.
// Sem escalação do jogo anterior: a posição do desfalcado fica desconhecida e o papel
// vem da afirmação, com o peso de não verificável (evidence.ts).

export const FACTS_BUDGET_MS = 20_000;
// = FORM_LAST do predict (lib/ai/predict.ts), a mesma janela que a página mostra.
const FORM_LAST = 5;

class FactTimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FactTimeoutError(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function fetchFact<T>(
  what: string,
  matchId: string,
  budgetMs: number,
  run: () => Promise<T>,
): Promise<Availability<T>> {
  try {
    return { available: true, data: await withTimeout(run(), budgetMs) };
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "user_palpite",
        event: "fact_unavailable",
        fact: what,
        matchId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { available: false };
  }
}

export async function fetchPalpiteFacts(
  match: Pick<DbMatch, "id" | "league" | "kickoffAt" | "homeTeam" | "awayTeam">,
  needs: { absences: boolean; form: boolean; standings: boolean },
  opts: { budgetMs?: number } = {},
): Promise<PalpiteFacts> {
  const budget = opts.budgetMs ?? FACTS_BUDGET_MS;
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const fact = <T>(what: string, run: () => Promise<T>) =>
    fetchFact(what, match.id, budget, run);

  const [absences, form, standings] = await Promise.all([
    needs.absences
      ? fact("absences", async () => {
          const d = await getAbsencesProvider().getAbsencesByFixture(ref);
          return { home: enrichAbsences(d.home), away: enrichAbsences(d.away) };
        })
      : undefined,
    needs.form
      ? fact("form", async () => {
          const sports = getSportsDataProvider();
          const [home, away] = await Promise.all([
            sports.getTeamForm(match.homeTeam, match.league, FORM_LAST),
            sports.getTeamForm(match.awayTeam, match.league, FORM_LAST),
          ]);
          return { home, away };
        })
      : undefined,
    needs.standings
      ? fact("standings", async () => {
          const s = await getSportsDataProvider().getStandings(match.league);
          if (!s) throw new Error("standings undefined");
          return s;
        })
      : undefined,
  ]);

  const facts: PalpiteFacts = {};
  if (absences) facts.absences = absences;
  if (form) facts.form = form;
  if (standings) facts.standings = standings;
  return facts;
}
