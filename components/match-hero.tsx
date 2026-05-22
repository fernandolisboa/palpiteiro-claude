import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/team-avatar";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchHeroView } from "@/lib/view/types";

type Props = {
  view: MatchHeroView;
  status?: "scheduled" | "live" | "finished";
  score?: { home: number; away: number };
};

export function MatchHero({ view, status = "scheduled", score }: Props) {
  const { home, away, league, when, countdown, venue } = view;
  return (
    <div className="px-5 pt-5 pb-5">
      <div className="flex items-center justify-between pb-4">
        <Badge
          variant="outline"
          className="h-[19px] rounded-full px-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          {LEAGUE_LABEL[league]}
        </Badge>
        <div className="flex items-center gap-2 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {status === "live" && (
            <span className="inline-flex items-center gap-1 text-warn-fg">
              <span className="size-1.5 rounded-full bg-warn-fg animate-pulse" />
              LIVE
            </span>
          )}
          {when}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2.5">
          <TeamAvatar initials={home.short.slice(0, 2)} hue={home.hue} size={56} />
          <span className="text-center text-[13px] font-medium leading-tight tracking-tight">
            {home.name}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          {score ? (
            <span className="font-mono text-[28px] font-medium tabular-nums tracking-tight">
              {score.home}–{score.away}
            </span>
          ) : (
            <span className="text-[18px] font-medium text-muted-foreground tracking-tight">
              vs
            </span>
          )}
          {countdown && (
            <span className="pt-1 font-mono text-[11px] tabular-nums text-accent-fg">
              {countdown}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <TeamAvatar initials={away.short.slice(0, 2)} hue={away.hue} size={56} />
          <span className="text-center text-[13px] font-medium leading-tight tracking-tight">
            {away.name}
          </span>
        </div>
      </div>

      {venue && (
        <div className="flex items-center justify-center gap-1.5 pt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-fg-2">
          <span>{venue}</span>
        </div>
      )}
    </div>
  );
}
