import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

function CollapsibleSkeleton({ open = false }: { open?: boolean }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-[14px] w-32" />
        </div>
        <Skeleton className="h-[12px] w-16" />
      </div>
      {open && (
        <>
          <Separator />
          <div className="flex flex-col gap-3 px-4 py-4">
            <Skeleton className="h-[14px] w-full" />
            <Skeleton className="h-[14px] w-3/4" />
            <Skeleton className="h-[14px] w-2/3" />
          </div>
        </>
      )}
    </Card>
  );
}

export function MatchSectionsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CollapsibleSkeleton open />
        <CollapsibleSkeleton open />
      </div>
      <div className="pt-3">
        <CollapsibleSkeleton open />
      </div>
    </>
  );
}

export function MatchAuxiliarySkeleton() {
  return (
    <>
      <div className="pt-3">
        <CollapsibleSkeleton />
      </div>
      <div className="pt-3">
        <CollapsibleSkeleton />
      </div>
    </>
  );
}
