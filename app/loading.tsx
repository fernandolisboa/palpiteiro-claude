import { DesktopShell } from "@/components/desktop-shell";
import { PageHeader } from "@/components/page-header";
import { SectionLabel } from "@/components/section-label";
import {
  DesktopMatchListSkeleton,
  MobileMatchListSkeleton,
} from "@/components/skeletons/match-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="lg:hidden">
        <div className="min-h-screen bg-background text-foreground">
          <PageHeader subtitle="carregando…" />
          <div className="px-5 pb-5 pt-1">
            <h1 className="text-[26px] font-medium leading-[1.05] tracking-[-0.03em]">
              Próximos jogos
            </h1>
            <p className="pt-1.5 text-[13px] text-muted-foreground tracking-tight">
              Over / under 2.5 — análise sob demanda.
            </p>
          </div>
          <div className="px-5 pb-3">
            <Skeleton className="h-9 w-[260px] rounded-md" />
          </div>
          <SectionLabel>Próximas 48h</SectionLabel>
          <MobileMatchListSkeleton />
        </div>
      </div>
      <div className="hidden lg:block">
        <DesktopShell>
          <div className="mx-auto w-full max-w-[1040px] px-8 pt-10 pb-16">
            <div className="flex items-end justify-between pb-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-[32px] font-medium leading-[1] tracking-[-0.035em]">
                  Próximos jogos
                </h1>
                <Skeleton className="h-[14px] w-72" />
              </div>
              <Skeleton className="h-9 w-[260px] rounded-md" />
            </div>
            <DesktopMatchListSkeleton />
          </div>
        </DesktopShell>
      </div>
    </>
  );
}
