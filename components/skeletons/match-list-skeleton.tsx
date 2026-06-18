import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchRowSkeleton } from "@/components/match-row";
import { UPCOMING_GRID } from "@/components/upcoming-matches-desktop";

export function MobileMatchListSkeleton() {
  return (
    <Card className="mx-5 gap-0 overflow-hidden p-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <MatchRowSkeleton key={i} last={i === 4} />
      ))}
    </Card>
  );
}

export function DesktopMatchListSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`grid ${UPCOMING_GRID} items-center gap-4 px-5 py-4 ${
            i === 4 ? "" : "border-b border-border-subtle"
          }`}
        >
          <div className="flex flex-col gap-1">
            <Skeleton className="h-[18px] w-20" />
            <Skeleton className="h-[12px] w-24" />
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
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-[13px] w-14" />
            <Skeleton className="h-[13px] w-14" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-5 w-16" />
          </div>
          <span />
        </div>
      ))}
    </Card>
  );
}
