import { BetSlip } from "@/components/bet-slip";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BetGridView } from "@/lib/view/bet-slip";

// "Registrar apostas" fora do caminho crítico: a grade precisa do modelo do jogo
// (tabela + ratings) e das odds de referência (lidas DEPOIS do refresh que a página já
// faz), então chega por streaming como os cards de odds. A promise é criada UMA vez
// pela página e compartilhada pelas árvores celular e desktop.
export async function BetSlipSection({
  matchId,
  grid,
  variant,
}: {
  matchId: string;
  grid: Promise<BetGridView>;
  variant: "mobile" | "desktop";
}) {
  return <BetSlip matchId={matchId} grid={await grid} variant={variant} />;
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
