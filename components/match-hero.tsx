import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LiveBadge } from "@/components/live-badge";
import { TeamAvatar } from "@/components/team-avatar";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchHeroView } from "@/lib/view/types";

type Props = {
  view: MatchHeroView;
  status?: "scheduled" | "live" | "finished";
  score?: { home: number; away: number };
  // Hrefs do histórico de cada time (#408), montados em nível de página a partir
  // do canonical persistido (match.homeTeam/awayTeam) → imunes a mismatch por
  // construção. Ausentes (default) → nome não clicável (call sites legados intactos).
  homeHref?: string;
  awayHref?: string;
};

// Bloco de um time: vertical no mobile (avatar em cima, nome centrado), linha no
// desktop (avatar à esquerda, nome + rótulo casa/visitante à direita). O rótulo
// (literal de apresentação; i18n é #323) só aparece no desktop. 22px do nome é um
// outlier heroic sem degrau na escala (ADR 0029) — preservado em lg:.
function TeamBlock({
  team,
  role,
  href,
}: {
  team: MatchHeroView["home"];
  role: string;
  href?: string;
}) {
  // Nome clicável (#408) → histórico do time. Sem href, segue um <span> simples.
  const name = href ? (
    <Link
      href={href}
      className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {team.name}
    </Link>
  ) : (
    team.name
  );
  return (
    <div className="flex flex-col items-center gap-2.5 lg:flex-row lg:items-center lg:gap-3">
      <TeamAvatar initials={team.short.slice(0, 2)} hue={team.hue} size={56} flagCode={team.flagCode} />
      <div className="flex flex-col items-center lg:items-start">
        <span className="text-center text-body font-medium leading-tight tracking-tight lg:text-left lg:text-[22px] lg:tracking-[-0.02em]">
          {name}
        </span>
        <span className="hidden font-mono text-eyebrow uppercase tracking-label text-muted-foreground lg:inline">
          {role}
        </span>
      </div>
    </div>
  );
}

// Hero responsivo único (#246): mobile (grid 3-col, placar 28px→display-md) e
// desktop (flex, placar 30px outlier) num só componente. Mesmo MatchHeroView, mesmos
// gates (score→placar, status==='live'→pill, venue) ⇒ paridade de dados. Deltas de
// apresentação conscientes: o desktop ganha a pill LIVE (estado raro, aditivo) e o
// countdown é guardado por viewport (header no desktop, sob o placar no mobile).
export function MatchHero({
  view,
  status = "scheduled",
  score,
  homeHref,
  awayHref,
}: Props) {
  const { home, away, league, when, countdown, venue } = view;
  return (
    <div className="px-5 pt-5 pb-5 lg:px-0 lg:pt-0 lg:pb-0">
      <div className="flex items-center justify-between pb-4 lg:justify-start lg:gap-3 lg:pb-5">
        <Badge
          variant="outline"
          className="h-5 rounded-full px-2 text-eyebrow uppercase tracking-label text-muted-foreground"
        >
          {LEAGUE_LABEL[league]}
        </Badge>
        <div className="flex items-center gap-2 font-mono text-eyebrow tabular-nums text-muted-foreground lg:text-meta">
          {status === "live" && <LiveBadge />}
          {when}
        </div>
        {countdown && (
          <span className="hidden font-mono text-meta tabular-nums text-accent-fg lg:inline">
            {countdown}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 lg:flex lg:items-center lg:gap-8">
        <TeamBlock team={home} role="casa" href={homeHref} />
        <div className="flex flex-col items-center gap-0.5">
          {score ? (
            <span className="font-mono text-display-md font-medium leading-none tabular-nums tracking-tight lg:text-[30px]">
              {score.home}
              <span className="px-1.5 text-muted-foreground lg:px-2">–</span>
              {score.away}
            </span>
          ) : (
            <span className="text-display-sm font-medium text-muted-foreground tracking-tight lg:text-[22px]">
              vs
            </span>
          )}
          {score && (
            <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2">
              encerrado
            </span>
          )}
          {countdown && (
            <span className="pt-1 font-mono text-meta tabular-nums text-accent-fg lg:hidden">
              {countdown}
            </span>
          )}
        </div>
        <TeamBlock team={away} role="visitante" href={awayHref} />
      </div>

      {venue && (
        <div className="flex items-center justify-center gap-1.5 pt-4 font-mono text-eyebrow uppercase tracking-label text-muted-fg-2 lg:justify-start lg:gap-4 lg:pt-5">
          <span>{venue}</span>
        </div>
      )}
    </div>
  );
}
