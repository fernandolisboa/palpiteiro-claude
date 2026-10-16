import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveBadge } from "@/components/live-badge";
import { AnalyzedBadge } from "@/components/match-list/analyzed-badge";
import { RowTrailing } from "@/components/match-list/row-trailing";
import { MatchModelLine } from "@/components/match-model-line";
import { TeamCrest } from "@/components/team-crest";
import { appendBackParam } from "@/lib/view/back-href";
import { showsRowLiveBadge } from "@/lib/view/match-list";
import { cn } from "@/lib/utils";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchRowView } from "@/lib/view/types";

type Props = {
  m: MatchRowView;
  last?: boolean;
  // URL filtrada da lista de origem (/jogos?…) → preserva o estado de busca ao
  // abrir o jogo e voltar. Ausente → link limpo (`/match/<id>`).
  listHref?: string;
  // Href completo de "voltar" pra origens FORA de /jogos (ex.: histórico do time
  // /time/[team], #408). Quando presente, é anexado como ?back= verbatim (tem
  // precedência sobre listHref).
  backHref?: string;
  // Alvo do passo "abra um jogo" do tour guiado (components/tour/guided-tour.tsx).
  tourTarget?: boolean;
  // Hora da linha quando a lista já agrupa por dia (/jogos, #577): "19:00" ou, nas
  // últimas 3h, "em 2h 15min". Ausente → `m.kickoff` com a data ("amanhã, 19:00"),
  // como o /time, que não agrupa por dia.
  timeLabel?: string;
};

// Linha da lista de jogos no celular e no /time (#577). Em cima, a hora (ou AO VIVO,
// no lugar dela) e a liga; à direita, "analisado" (no celular ele não disputa a
// largura das odds). No meio, os times e o lado direito por fase (RowTrailing: odds
// lado a lado, placar, adiado). Embaixo, a linha do modelo quando há base.
export function MatchRow({ m, last, listHref, backHref, tourTarget, timeLabel }: Props) {
  // /time/[team] (#408) passa o backHref pronto; /jogos passa listHref e deriva o
  // back via appendBackParam (base /jogos). Mutuamente exclusivos na prática.
  const href = backHref
    ? `/match/${m.id}?back=${encodeURIComponent(backHref)}`
    : appendBackParam(`/match/${m.id}`, listHref, "/jogos");
  const isLive = showsRowLiveBadge(m);
  return (
    <Link
      href={href}
      data-tour={tourTarget ? "match-row" : undefined}
      className={cn(
        "block px-5 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
        !last && "border-b border-border-subtle",
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {isLive ? (
            // Ao vivo (#385, #574): o selo no lugar da hora, uma vez por linha.
            <span className="shrink-0 text-meta font-medium">
              <LiveBadge />
            </span>
          ) : (
            <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">
              {timeLabel ?? m.kickoff}
            </span>
          )}
          <Badge
            variant="outline"
            size="xs"
            className="uppercase tracking-label text-muted-foreground"
          >
            {LEAGUE_LABEL[m.league]}
          </Badge>
        </div>
        {m.hasPrediction && <AnalyzedBadge />}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <TeamCrest team={m.home} size={22} />
            <span className="truncate text-label font-medium tracking-tight" title={m.home.fullName}>
              {m.home.name}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <TeamCrest team={m.away} size={22} />
            <span className="truncate text-label font-medium tracking-tight" title={m.away.fullName}>
              {m.away.name}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <RowTrailing m={m} />
          <span className="text-muted-fg-2">
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </span>
        </div>
      </div>
      {/* Base do modelo (#555): só em jogo analisável com base calculada. */}
      {m.model && <MatchModelLine model={m.model} className="block pt-2" />}
    </Link>
  );
}

export function MatchRowSkeleton({ last }: { last?: boolean }) {
  return (
    <div className={cn("px-5 py-3.5", !last && "border-b border-border-subtle")}>
      <div className="flex items-center gap-2 pb-2">
        <Skeleton className="h-[12px] w-10" />
        <Skeleton className="h-[18px] w-20" />
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
        <div className="flex items-center gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-end gap-1">
              <Skeleton className="h-[11px] w-8" />
              <Skeleton className="h-[13px] w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
