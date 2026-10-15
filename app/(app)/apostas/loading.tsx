import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function ApostasLoading() {
  return (
    <div className="bg-background text-foreground">
      <PageContainer width="reading">
        <PageHeaderSkeleton title="Suas apostas" description />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-border px-4 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-14" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </PageContainer>
    </div>
  );
}
