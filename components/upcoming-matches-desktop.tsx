"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DesktopStatusCell } from "@/components/desktop-status-cell";
import { TeamAvatar } from "@/components/team-avatar";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchRowView } from "@/lib/view/types";

const INITIAL_BATCH = 15;
const BATCH_STEP = 15;

export const UPCOMING_GRID = "grid-cols-[160px_1fr_160px_140px_40px]";

// Rótulo PT-BR pros status sem placar nem CTA de análise (espelha app/page.tsx).
const STATUS_LABEL: Record<"postponed" | "cancelled", string> = {
  postponed: "Adiado",
  cancelled: "Cancelado",
};

export function UpcomingMatchesDesktop({
  matches,
}: {
  matches: MatchRowView[];
}) {
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const slice = matches.slice(0, visible);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className={`grid ${UPCOMING_GRID} gap-4 border-b border-border px-5 py-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground`}>
        <span>liga · kickoff</span>
        <span>jogo</span>
        <span className="text-right">odds</span>
        <span className="text-right">status</span>
        <span />
      </div>
      {slice.map((m, i, arr) => (
        <Link
          key={m.id}
          href={`/match/${m.id}`}
          className={`grid ${UPCOMING_GRID} items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset ${
            i === arr.length - 1 ? "" : "border-b border-border-subtle"
          }`}
        >
          <div className="flex flex-col gap-1">
            <Badge
              variant="outline"
              size="xs"
              className="w-fit rounded-full px-2 uppercase tracking-label text-muted-foreground"
            >
              {LEAGUE_LABEL[m.league]}
            </Badge>
            <span className="font-mono text-meta tabular-nums text-muted-foreground">
              {m.kickoff}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <TeamAvatar initials={m.home.short.slice(0, 2)} hue={m.home.hue} size={22} flagCode={m.home.flagCode} />
              <span className="text-label font-medium tracking-tight">{m.home.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <TeamAvatar initials={m.away.short.slice(0, 2)} hue={m.away.hue} size={22} flagCode={m.away.flagCode} />
              <span className="text-label font-medium tracking-tight">{m.away.name}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 font-mono text-body tabular-nums">
            {m.status === "finished" &&
            m.homeScore !== null &&
            m.awayScore !== null ? (
              <span className="text-label font-medium">
                {m.homeScore}
                <span className="px-1 text-muted-foreground">–</span>
                {m.awayScore}
              </span>
            ) : m.status === "finished" ? (
              // Encerrado sem placar reportado: não cai no "sem odd".
              <span className="text-eyebrow uppercase tracking-label text-muted-fg-2">
                —
              </span>
            ) : m.status === "postponed" || m.status === "cancelled" ? (
              <span className="text-eyebrow uppercase tracking-label text-muted-fg-2">
                {STATUS_LABEL[m.status]}
              </span>
            ) : m.odds ? (
              <>
                {m.odds.outcomes.map((o, i) => (
                  <span key={i}>
                    <span className="text-muted-foreground">{o.label}</span>{" "}
                    {o.odd}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-muted-fg-2">sem odd</span>
            )}
          </div>
          <DesktopStatusCell m={m} />
          <span className="justify-self-end text-muted-fg-2">
            {m.status === "finished" ||
            m.status === "postponed" ||
            m.status === "cancelled" ? null : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
        </Link>
      ))}
      {visible < matches.length && (
        <div className="flex justify-center border-t border-border-subtle px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisible((v) => v + BATCH_STEP)}
          >
            Carregar mais
          </Button>
        </div>
      )}
    </Card>
  );
}
