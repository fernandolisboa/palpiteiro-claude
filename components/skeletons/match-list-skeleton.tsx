import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchRowSkeleton } from "@/components/match-row";
import { UPCOMING_GRID } from "@/components/upcoming-matches-desktop";

// Esqueletos da lista de jogos agrupada por dia (#577): cabeçalho do dia e as
// linhas com a hora, a liga, os times e as odds lado a lado.
export function MobileMatchListSkeleton() {
  return (
    <>
      <div className="px-5 pt-1 pb-2">
        <Skeleton className="h-[14px] w-16" />
      </div>
      <Card className="mx-5 gap-0 overflow-hidden p-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <MatchRowSkeleton key={i} last={i === 4} />
        ))}
      </Card>
    </>
  );
}

export function DesktopMatchListSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-border-subtle bg-surface-2 px-5 py-2">
        <Skeleton className="h-[14px] w-16" />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`grid ${UPCOMING_GRID} items-center gap-4 px-5 py-3.5 ${
            i === 4 ? "" : "border-b border-border-subtle"
          }`}
        >
          <div className="flex flex-col gap-1">
            <Skeleton className="h-[13px] w-10" />
            <Skeleton className="h-[18px] w-20" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-[22px] rounded-full" />
              <Skeleton className="h-[14px] w-28" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-[22px] rounded-full" />
              <Skeleton className="h-[14px] w-32" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex flex-col items-end gap-1">
                <Skeleton className="h-[11px] w-8" />
                <Skeleton className="h-[13px] w-10" />
              </div>
            ))}
          </div>
          <span />
        </div>
      ))}
    </Card>
  );
}
