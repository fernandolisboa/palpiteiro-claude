import { ChevronLeft } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";
import { SectionLabel } from "@/components/section-label";

function HeaderBar() {
  return (
    <header className="flex items-center justify-between px-5 pt-5 pb-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        <ChevronLeft className="size-3.5" />
        <span className="text-body-sm tracking-tight">jogos</span>
      </span>
      <Skeleton className="size-7 rounded-md" />
    </header>
  );
}

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
        <div className="min-h-screen bg-background text-foreground">
          <HeaderBar />
          <div className="px-5 pt-3 pb-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="mt-2 h-[12px] w-24" />
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
        <DesktopShell>
          <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
            <span className="mb-6 inline-flex items-center gap-2 text-muted-foreground">
              <ChevronLeft className="size-3.5" />
              <span className="text-body-sm tracking-tight">jogos</span>
            </span>
            <div className="pb-6">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="mt-2 h-[12px] w-24" />
            </div>
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
          </div>
        </DesktopShell>
      </div>
    </>
  );
}
