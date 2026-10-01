import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { appendBackParam } from "@/lib/view/back-href";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RecentPredictionView } from "@/lib/view/types";

export function RecentPredCard({
  p,
  listHref,
}: {
  p: RecentPredictionView;
  // URL filtrada da lista (/jogos?…) → preserva o estado de busca ao voltar.
  listHref?: string;
}) {
  const isPass = p.rec === "PASS";
  return (
    <Link
      href={appendBackParam(`/match/${p.matchId}`, listHref, "/jogos")}
      className="flex min-w-[180px] max-w-[240px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          {LEAGUE_LABEL[p.league]}
        </span>
        <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
          {p.when}
        </span>
      </div>
      <div className="font-mono text-body-sm tabular-nums tracking-tight">
        {p.home} <span className="text-muted-foreground">vs</span> {p.away}
      </div>
      <div className="truncate text-meta text-muted-foreground">{p.market}</div>
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          size="sm"
          className={cn(
            "min-w-0 max-w-full shrink font-semibold tracking-wide",
            isPass
              ? "border-border bg-transparent text-muted-foreground"
              : "border-accent-border bg-accent-soft text-accent-fg",
          )}
        >
          <span className="truncate">{p.rec}</span>
        </Badge>
        {p.edge && (
          <span className="shrink-0 font-mono text-meta tabular-nums text-edge-fg">
            {p.edge}pp
          </span>
        )}
      </div>
    </Link>
  );
}
