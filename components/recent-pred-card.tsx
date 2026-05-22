import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LEAGUE_LABEL, type RecentPrediction } from "@/lib/fixtures";

const REC_ICON: Record<RecentPrediction["rec"], string> = {
  OVER: "↑",
  UNDER: "↓",
  PASS: "—",
};

export function RecentPredCard({ p }: { p: RecentPrediction }) {
  const isPass = p.rec === "PASS";
  return (
    <Link
      href={`/match/${p.id}`}
      className="flex min-w-[180px] shrink-0 flex-col gap-2 rounded-[10px] border border-border bg-card px-3 py-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {LEAGUE_LABEL[p.league]}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {p.when}
        </span>
      </div>
      <div className="font-mono text-[12.5px] tabular-nums tracking-tight">
        {p.home} <span className="text-muted-foreground">vs</span> {p.away}
      </div>
      <div className="flex items-center justify-between pt-1">
        <Badge
          variant="outline"
          className={
            isPass
              ? "h-[19px] rounded-full border-border bg-transparent px-2 text-[10px] font-semibold tracking-wide text-muted-foreground"
              : "h-[19px] rounded-full border-accent-border bg-accent-soft px-2 text-[10px] font-semibold tracking-wide text-accent-fg"
          }
        >
          <span className="font-mono">{REC_ICON[p.rec]}</span>
          {p.rec}
        </Badge>
        {p.edge && (
          <span className="font-mono text-[11px] tabular-nums text-edge-fg">
            {p.edge}pp
          </span>
        )}
      </div>
    </Link>
  );
}
