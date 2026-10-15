import { Card } from "@/components/ui/card";
import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/section-label";

// Casa a forma de cada MatchRow (anti-CLS): badge + kickoff em cima, dois times,
// odd/placar à direita.
function RowSkeleton({ last }: { last?: boolean }) {
  return (
    <div className={last ? "px-5 py-4" : "border-b border-border-subtle px-5 py-4"}>
      <div className="flex items-center justify-between pb-2.5">
        <Skeleton className="h-[18px] w-20" />
        <Skeleton className="h-[12px] w-16" />
      </div>
      <div className="flex items-center justify-between">
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
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton last />
    </Card>
  );
}

export default function TeamHistoryLoading() {
  return (
    <>
      <div className="lg:hidden">
        <div className="bg-background text-foreground">
          <div className="px-5 pt-6">
            <PageHeaderSkeleton back meta className="pb-2" />
          </div>
          <div className="flex flex-col gap-2 pb-8">
            <SectionLabel>próximos jogos</SectionLabel>
            <div className="px-5">
              <ListSkeleton />
            </div>
            <div className="pt-3">
              <SectionLabel>últimos resultados</SectionLabel>
            </div>
            <div className="px-5">
              <ListSkeleton />
            </div>
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <>
          <PageContainer width="content">
            <PageHeaderSkeleton back meta />
            <div className="grid grid-cols-2 gap-8">
              <section className="flex flex-col gap-2">
                <SectionLabel>próximos jogos</SectionLabel>
                <ListSkeleton />
              </section>
              <section className="flex flex-col gap-2">
                <SectionLabel>últimos resultados</SectionLabel>
                <ListSkeleton />
              </section>
            </div>
          </PageContainer>
        </>
      </div>
    </>
  );
}
