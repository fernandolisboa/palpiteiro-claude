import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";

export default function DashboardLoading() {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="grid grid-cols-2 gap-3 pt-7 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-[260px] rounded-xl" />
        <Skeleton className="mt-8 h-[340px] rounded-xl" />
      </div>
    </DesktopShell>
  );
}
