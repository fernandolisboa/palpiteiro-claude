import { MarketTable } from "@/components/bet-slip/market-table";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { BetGridView } from "@/lib/view/bet-slip";

// Tabela de mercados fora do caminho crítico: espera o refresh de odds que a página já
// faz (nenhuma chamada nova), as odds de referência, o modelo do jogo e a fonte/JEV da
// base. Chega por streaming, uma vez por página (#576).
export async function MarketTableSection({ grid }: { grid: Promise<BetGridView> }) {
  return <MarketTable grid={await grid} />;
}

export function MarketTableSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-56" />
      </div>
      {[3, 3, 2, 2].map((n, i) => (
        <div key={i}>
          <Separator />
          <div className="flex flex-col gap-2 px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <div className={n === 3 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
              {Array.from({ length: n }, (_, j) => (
                <Skeleton key={j} className="h-[3.75rem] w-full" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}
