import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
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
        <div className="bg-background text-foreground">
          <div className="px-5 pt-6">
            <PageHeaderSkeleton title="Próximos jogos" meta className="pb-5" />
          </div>
          <div className="px-5 pb-3">
            <Skeleton className="h-9 w-[260px] rounded-md" />
          </div>
          <SectionLabel>Próximas 48h</SectionLabel>
          <MobileMatchListSkeleton />
        </div>
      </div>
      <div className="hidden lg:block">
          <PageContainer width="content">
            <PageHeaderSkeleton
              title="Próximos jogos"
              meta
              actions={<Skeleton className="h-9 w-[260px] rounded-md" />}
            />
            <DesktopMatchListSkeleton />
          </PageContainer>
      </div>
    </>
  );
}
