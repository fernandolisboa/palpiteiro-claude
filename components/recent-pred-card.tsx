import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LEAGUE_LABEL } from "@/lib/format";
import type { RecentPredictionView } from "@/lib/view/types";

export function RecentPredCard({ p }: { p: RecentPredictionView }) {
  const isPass = p.rec === "PASS";
  return (
    <Link
      href={`/match/${p.matchId}`}
      className="flex min-w-[180px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      <div className="flex items-center justify-between pt-1">
        <Badge
          variant="outline"
          size="sm"
          className={
            isPass
              ? "border-border bg-transparent font-semibold tracking-wide text-muted-foreground"
              : "border-accent-border bg-accent-soft font-semibold tracking-wide text-accent-fg"
          }
        >
          {p.rec}
        </Badge>
        {p.edge && (
          <span className="font-mono text-meta tabular-nums text-edge-fg">
            {p.edge}pp
          </span>
        )}
      </div>
    </Link>
  );
}
