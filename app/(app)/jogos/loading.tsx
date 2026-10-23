import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import {
  DesktopMatchListSkeleton,
  MobileMatchListSkeleton,
} from "@/components/skeletons/match-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// A linha de chips dos filtros (#577): liga | Escolher datas, Time, análise (#643),
// com as alturas dos chips de verdade (anti-CLS).
function FilterRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 overflow-hidden py-1", className)}>
      <Skeleton className="h-8 w-32 shrink-0 rounded-full" />
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <Skeleton className="h-8 w-32 shrink-0 rounded-full" />
      <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
      <Skeleton className="h-8 w-36 shrink-0 rounded-full" />
    </div>
  );
}

// O campo de busca (#643), na altura do de verdade.
function SearchSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-9 rounded-full", className)} />;
}

export default function Loading() {
  return (
    <>
      <div className="lg:hidden">
        <div className="bg-background text-foreground">
          <div className="px-5 pt-6">
            <PageHeaderSkeleton title="Próximos jogos" meta className="pb-4" />
          </div>
          <div className="px-5 pb-2">
            <SearchSkeleton />
          </div>
          <FilterRowSkeleton className="px-5 pb-3" />
          <MobileMatchListSkeleton />
        </div>
      </div>
      <div className="hidden lg:block">
        <PageContainer width="content">
          <PageHeaderSkeleton title="Próximos jogos" meta className="lg:pb-5" />
          <div className="flex items-center gap-3 pb-5">
            <SearchSkeleton className="w-72 shrink-0" />
            <FilterRowSkeleton className="min-w-0 flex-1" />
          </div>
          <DesktopMatchListSkeleton />
        </PageContainer>
      </div>
    </>
  );
}
