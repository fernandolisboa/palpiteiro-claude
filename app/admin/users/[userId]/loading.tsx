import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";

/**
 * Skeleton de cold-start do tracking de usuário (admin) (#324). Espelha
 * `app/dashboard/loading.tsx` — a página renderiza os mesmos widgets
 * (KpiCards/MarketSegments/BankrollChart/PredictionsTable) sob DesktopShell +
 * `max-w-content` — com um back-link + bloco de controles a mais.
 */
export default function AdminUserLoading() {
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-8 h-[120px] rounded-xl" />
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
