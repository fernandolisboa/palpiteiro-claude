import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/utils";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchRowView } from "@/lib/view/types";

type Props = {
  m: MatchRowView;
  last?: boolean;
};

const STATUS_LABEL: Record<"postponed" | "cancelled", string> = {
  postponed: "Adiado",
  cancelled: "Cancelado",
};

export function MatchRow({ m, last }: Props) {
  const isFinished = m.status === "finished";
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  return (
    <Link
      href={`/match/${m.id}`}
      className={cn(
        "block px-5 py-4 transition-colors hover:bg-surface-2",
        !last && "border-b border-border-subtle",
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="h-[18px] rounded-full px-2 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground"
          >
            {LEAGUE_LABEL[m.league]}
          </Badge>
          {m.hasPrediction && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] text-accent-fg">
              <Check className="size-3" />
              analisado
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {m.kickoff}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <TeamAvatar initials={m.home.short.slice(0, 2)} hue={m.home.hue} size={22} />
            <span className="truncate text-[14px] font-medium tracking-tight">
              {m.home.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TeamAvatar initials={m.away.short.slice(0, 2)} hue={m.away.hue} size={22} />
            <span className="truncate text-[14px] font-medium tracking-tight">
              {m.away.name}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isFinished && hasScore ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-mono text-[15px] font-medium tabular-nums">
                {m.homeScore}
                <span className="px-1 text-muted-foreground">–</span>
                {m.awayScore}
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-fg-2">
                encerrado
              </span>
            </div>
          ) : isFinished ? (
            // Encerrado sem placar reportado: marca o estado sem inventar 0–0
            // nem cair no "sem odd" (que sugeriria um jogo ainda apostável).
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-fg-2">
              encerrado
            </span>
          ) : m.status === "postponed" || m.status === "cancelled" ? (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-fg-2">
              {STATUS_LABEL[m.status]}
            </span>
          ) : m.odds ? (
            <div className="flex flex-col items-end gap-1 font-mono text-[12.5px] tabular-nums">
              <span>
                <span className="text-muted-foreground">O</span> {m.odds.over}
              </span>
              <span>
                <span className="text-muted-foreground">U</span> {m.odds.under}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[10.5px] text-muted-fg-2">
              sem odd
            </span>
          )}
          <span className="ml-1 text-muted-fg-2">
            <ChevronRight className="size-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function MatchRowSkeleton({ last }: { last?: boolean }) {
  return (
    <div className={cn("px-5 py-4", !last && "border-b border-border-subtle")}>
      <div className="flex items-center justify-between pb-2.5">
        <Skeleton className="h-[18px] w-20" />
        <Skeleton className="h-[12px] w-16" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-[22px] rounded-full" />
            <Skeleton className="h-[14px] w-28" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-[22px] rounded-full" />
            <Skeleton className="h-[14px] w-32" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-[13px] w-14" />
          <Skeleton className="h-[13px] w-14" />
        </div>
      </div>
    </div>
  );
}
