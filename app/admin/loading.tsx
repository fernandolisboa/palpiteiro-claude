import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de cold-start (Neon ~1s) das páginas bare do admin (#324). Cobre por
 * cascata admin root + costs + settings + predictions/[id] + users (mesmo idioma:
 * `min-h-screen bg-background` + `max-w-reading px-6 py-8` + header). As rotas
 * DesktopShell têm seus próprios `loading.tsx`.
 */
export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
