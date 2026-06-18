import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";

export default function PredictionDetailLoading() {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-7 w-64" />
        <Skeleton className="mt-2 h-3 w-48" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}
