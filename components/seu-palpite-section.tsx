import { SeuPalpite } from "@/components/seu-palpite";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TeamNames } from "@/lib/user-palpite/reading";
import type { SeuPalpiteData } from "@/lib/view/user-palpite";

// "Seu palpite" (#564) por streaming: o modelo do jogo (a base ou o cálculo ao vivo,
// compartilhado com a grade de apostas) e a última análise do usuário chegam numa
// promise criada UMA vez pela página e usada pelas árvores celular e desktop.
export async function SeuPalpiteSection({
  matchId,
  teams,
  data,
  aiEnabled,
  variant,
}: {
  matchId: string;
  teams: TeamNames;
  data: Promise<SeuPalpiteData>;
  aiEnabled: boolean;
  variant: "mobile" | "desktop";
}) {
  const { model, latest } = await data;
  return (
    <SeuPalpite
      matchId={matchId}
      teams={teams}
      model={model}
      latest={latest}
      aiEnabled={aiEnabled}
      variant={variant}
    />
  );
}

export function SeuPalpiteSkeleton() {
  return (
    <Card className="gap-3 p-4">
      <Skeleton className="h-[14px] w-32" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}
