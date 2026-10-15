import { formatOdd, formatPct, formatRelativeAgo } from "@/lib/format";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { getDisplayPresentation } from "@/lib/view/markets/display";
import type { TeamLabels } from "@/lib/view/markets/with-team-labels";
import type { MatchRowView, OddsView } from "@/lib/view/types";

export type OddsSnapshotInput = {
  bookmaker: string;
  overOdd: number | string;
  underOdd: number | string;
  capturedAt: Date;
};

// O snapshot vivo é binário over/under (the-odds-api) — o único mercado com
// reader de snapshot hoje. Resolve os rótulos por lado via registry pra
// de-hardcodar "Over 2.5"/"O"/badge dos componentes (AC3); live N-vias = Fase 4.
const LIVE_ODDS_PRESENTATION = getDisplayPresentation("over_under");
// Label COMPLETO ("Mais de 2,5"/"Menos de 2,5") — headers do OddsCard (toOddsView).
const LIVE_OVER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "over",
  LIVE_ODDS_PRESENTATION.defaultLine,
);
const LIVE_UNDER_LABEL = LIVE_ODDS_PRESENTATION.outcomeLabel(
  "under",
  LIVE_ODDS_PRESENTATION.defaultLine,
);
// Chips densos da match-list (coluna ~160px): também com a linha ("Mais de 2,5"),
// porque "Mais de 1,85" sem a linha seria ambíguo (ADR 0056).
const LIVE_OVER_SHORT = LIVE_OVER_LABEL;
const LIVE_UNDER_SHORT = LIVE_UNDER_LABEL;

export function toOddsView(
  snapshot: OddsSnapshotInput,
  now: Date = new Date(),
): OddsView {
  const overOdd = Number(snapshot.overOdd);
  const underOdd = Number(snapshot.underOdd);
  // over/under = caso N=2 do core (probs[0]=over, probs[1]=under) — bit-exato com
  // o wrapper binário removido na Fase 5; DOM byte-idêntico (golden pina).
  const { probs, overround } = computeMarketImpliedProbabilities([
    overOdd,
    underOdd,
  ]);
  const [overProb, underProb] = probs;
  return {
    marketLabel: LIVE_ODDS_PRESENTATION.marketLabel,
    // Forma N-vias (#173): over/under = 2 outcomes na ordem over→under. Mesmos
    // valores/labels/formatters de antes → DOM byte-idêntico (golden pina).
    outcomes: [
      {
        label: LIVE_OVER_LABEL,
        odd: formatOdd(overOdd),
        pct: formatPct(overProb * 100, { decimals: 1 }),
      },
      {
        label: LIVE_UNDER_LABEL,
        odd: formatOdd(underOdd),
        pct: formatPct(underProb * 100, { decimals: 1 }),
      },
    ],
    bookmaker: snapshot.bookmaker,
    overround: formatPct(overround * 100, { decimals: 1 }),
    updatedAgo: formatRelativeAgo(snapshot.capturedAt, now),
  };
}

// Captura N-vias genérica (saída do reader best-effort) — o que o card 1X2 lê.
// overroundPct armazenado é IGNORADO de propósito: a view RE-DERIVA (igual ao
// over/under) pra os dois cards derivarem a implícita/overround do mesmo jeito.
export type NwayOddsInput = {
  bookmaker: string;
  capturedAt: Date;
  selections: { key: string; odd: string }[];
};

/**
 * View genérica N-vias pra mercados Σ=1 featured (1X2 hoje). RE-DERIVA probs +
 * overround do mercado COMPLETO via `computeMarketImpliedProbabilities` (nunca
 * `1/odd` cru; nunca o overroundPct armazenado — paridade com toOddsView). Labels
 * vêm do registry puro com os rótulos de tela (`getDisplayPresentation`) — NÃO importa
 * market-descriptor (pureza de bundle; match_result é Σ=1, não precisa de
 * impliedSumTarget). numeric do Drizzle = string → `Number()` no boundary.
 */
export function toNwayOddsView(
  snapshot: NwayOddsInput,
  marketKey: string,
  now: Date = new Date(),
  teams?: TeamLabels,
): OddsView {
  const presentation = getDisplayPresentation(marketKey, teams);
  const odds = snapshot.selections.map((s) => Number(s.odd));
  const { probs, overround } = computeMarketImpliedProbabilities(odds);
  return {
    marketLabel: presentation.marketLabel,
    outcomes: snapshot.selections.map((s, i) => ({
      label: presentation.outcomeLabel(s.key, presentation.defaultLine),
      odd: formatOdd(odds[i]),
      pct: formatPct(probs[i] * 100, { decimals: 1 }),
    })),
    bookmaker: snapshot.bookmaker,
    overround: formatPct(overround * 100, { decimals: 1 }),
    updatedAgo: formatRelativeAgo(snapshot.capturedAt, now),
  };
}

export function toMatchRowOdds(
  snapshot: OddsSnapshotInput | null,
): NonNullable<MatchRowView["odds"]> | null {
  if (!snapshot) return null;
  // Forma N-vias (#173): over/under = 2 outcomes na ordem over→under, labels
  // CURTOS. Byte-idêntico ao chip binário pré-#173 (golden pina). A regra de
  // prioridade 1X2>over/under entra com a fonte N-vias (toMatchRowOddsResolved).
  return {
    outcomes: [
      { label: LIVE_OVER_SHORT, odd: formatOdd(snapshot.overOdd) },
      { label: LIVE_UNDER_SHORT, odd: formatOdd(snapshot.underOdd) },
    ],
  };
}

// Outcomes do chip pra uma captura N-vias (1X2) — labels CURTOS (selectionLabel:
// "Casa"/"Empate"/"Fora"), na ordem canônica já resolvida pelo reader. Sem pct
// (o chip mostra só odds). numeric do Drizzle = string → formatOdd coage.
export function toMatchRowResultOdds(
  snapshot: { selections: { key: string; odd: string }[] },
  marketKey: string,
  teams?: TeamLabels,
): NonNullable<MatchRowView["odds"]> {
  const presentation = getDisplayPresentation(marketKey, teams);
  return {
    outcomes: snapshot.selections.map((s) => ({
      label: presentation.selectionLabel(s.key),
      odd: formatOdd(s.odd),
    })),
  };
}
