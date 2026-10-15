import { formatOdd } from "@/lib/format";
import { getDisplayPresentation } from "@/lib/view/markets/display";
import type { TeamLabels } from "@/lib/view/markets/with-team-labels";
import type { MatchRowView } from "@/lib/view/types";

export type OddsSnapshotInput = {
  bookmaker: string;
  overOdd: number | string;
  underOdd: number | string;
  capturedAt: Date;
};

// Chips de odds da lista de jogos (/jogos). O snapshot vivo legado é binário over/under;
// os rótulos por lado vêm do registry de tela. A página do jogo lê as capturas pela
// tabela de mercados (lib/view/bet-slip.ts, #576).
const LIVE_ODDS_PRESENTATION = getDisplayPresentation("over_under");
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
