import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <>
      <PageContainer width="content">
        <PageHeaderSkeleton title="Desempenho" description />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-[260px] rounded-xl" />
        <Skeleton className="mt-8 h-[340px] rounded-xl" />
      </PageContainer>
    </>
  );
}
