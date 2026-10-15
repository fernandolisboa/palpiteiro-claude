import { OddsCard } from "@/components/odds-card";
import type { MatchUnavailableReason } from "@/lib/view/match-availability";
import type { OddsView } from "@/lib/view/types";

export type MatchOddsViews = {
  // Over/under (card principal). null = sem captura → empty-state do OddsCard.
  oddsView: OddsView | null;
  // Card 1X2 ao vivo (#173), empilhado abaixo. null = sem captura h2h → não renderiza.
  matchResultOddsView: OddsView | null;
};

type Props = {
  // Promise criada UMA vez pela página (o refresh de odds pode chamar a The Odds API);
  // a grade de apostas espera o mesmo refresh.
  odds: Promise<MatchOddsViews>;
  unavailable: MatchUnavailableReason | null;
};

// Cards de odds do jogo, fora do caminho crítico do render: a página abre na hora e
// estes cards chegam por streaming (Suspense) quando o refresh termina.
export async function MatchOddsCards({ odds, unavailable }: Props) {
  const { oddsView, matchResultOddsView } = await odds;
  return (
    <>
      <OddsCard view={oddsView} unavailable={unavailable} />
      {matchResultOddsView && (
        <OddsCard view={matchResultOddsView} unavailable={unavailable} />
      )}
    </>
  );
}
