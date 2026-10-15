import { MarketTable } from "@/components/bet-slip/market-table";
import { SlipMobileRiskNotice } from "@/components/bet-slip/risk-notice";
import { SlipMobileBar } from "@/components/bet-slip/slip-mobile-bar";
import { SlipAside } from "@/components/bet-slip/slip-panel";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BetGridView } from "@/lib/view/bet-slip";

// "Registrar apostas" fora do caminho crítico: a grade precisa do modelo do jogo
// (tabela + ratings) e das odds de referência (lidas DEPOIS do refresh que a página já
// faz), então chega por streaming como os cards de odds. Renderizada uma vez por página
// (#576: uma árvore responsiva). O estado da lista mora no BetSlipProvider da página.
export async function BetSlipSection({ grid }: { grid: Promise<BetGridView> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">
        <MarketTable grid={await grid} />
        <SlipAside />
      </div>
      <SlipMobileRiskNotice />
      <SlipMobileBar />
    </div>
  );
}

export function BetSlipSkeleton() {
  return (
    <Card className="gap-3 p-4">
      <Skeleton className="h-[14px] w-40" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </Card>
  );
}
