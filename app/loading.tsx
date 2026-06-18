import { DesktopShell } from "@/components/desktop-shell";
import { HOME_SUBTITLE } from "@/lib/copy";
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
            <h1 className="text-display-md font-medium leading-none tracking-tight">
              Próximos jogos
            </h1>
            <p className="pt-1.5 text-body text-muted-foreground tracking-tight">
              {HOME_SUBTITLE}
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
          <div className="mx-auto w-full max-w-content px-8 pt-10 pb-16">
            <div className="flex items-end justify-between pb-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-display-lg font-medium leading-none tracking-tight">
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
