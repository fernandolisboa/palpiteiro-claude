import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function PredictionDetailLoading() {
  return (
    <>
      <PageContainer width="reading">
        <PageHeaderSkeleton back meta className="pb-2 lg:pb-2" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </PageContainer>
    </>
  );
}
