import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveBadge } from "@/components/live-badge";
import { TeamAvatar } from "@/components/team-avatar";
import { appendBackParam } from "@/lib/view/back-href";
import { cn } from "@/lib/utils";
import { LEAGUE_LABEL } from "@/lib/format";
import type { MatchRowView } from "@/lib/view/types";

type Props = {
  m: MatchRowView;
  last?: boolean;
  // URL filtrada da lista de origem (/jogos?…) → preserva o estado de busca ao
  // abrir o jogo e voltar. Ausente → link limpo (`/match/<id>`), goldens intactos.
  listHref?: string;
  // Href completo de "voltar" pra origens FORA de /jogos (ex.: histórico do time
  // /time/[team], #408). Quando presente, é anexado como ?back= verbatim (tem
  // precedência sobre listHref). Mantém os call sites de /jogos byte-idênticos.
  backHref?: string;
};

const STATUS_LABEL: Record<"postponed" | "cancelled", string> = {
  postponed: "Adiado",
  cancelled: "Cancelado",
};

export function MatchRow({ m, last, listHref, backHref }: Props) {
  // /time/[team] (#408) passa o backHref pronto; /jogos passa listHref e deriva o
  // back via appendBackParam (base /jogos). Mutuamente exclusivos na prática.
  const href = backHref
    ? `/match/${m.id}?back=${encodeURIComponent(backHref)}`
    : appendBackParam(`/match/${m.id}`, listHref, "/jogos");
  const isFinished = m.status === "finished";
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  // "Ao vivo" = status DB `live` OU derivado isInProgress (#385): o último pega o
  // jogo recém-apitado ainda DB-`scheduled`; o `live` cru pega um jogo de verdade
  // ao vivo mais velho que 3h (que isInProgress exclui) — sem ele cairia no branch
  // de odds e pareceria apostável.
  const isLive = m.status === "live" || m.isInProgress;
  return (
    <Link
      href={href}
      className={cn(
        "block px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
        !last && "border-b border-border-subtle",
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            size="xs"
            className="uppercase tracking-label text-muted-foreground"
          >
            {LEAGUE_LABEL[m.league]}
          </Badge>
          {m.hasPrediction && (
            <span className="inline-flex items-center gap-1 font-mono text-eyebrow text-accent-fg">
              <Check className="size-3" />
              analisado
            </span>
          )}
        </div>
        {isLive ? (
          // Ao vivo (#385): a badge precede o kickoff num flex. A linha agendada
          // mantém o <span> simples original (golden byte-idêntico — só a linha
          // live ganha o wrapper).
          <span className="flex items-center gap-2 font-mono text-meta tabular-nums text-muted-foreground">
            <LiveBadge />
            {m.kickoff}
          </span>
        ) : (
          <span className="font-mono text-meta tabular-nums text-muted-foreground">
            {m.kickoff}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <TeamAvatar initials={m.home.short.slice(0, 2)} hue={m.home.hue} size={22} flagCode={m.home.flagCode} />
            <span className="truncate text-label font-medium tracking-tight">
              {m.home.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TeamAvatar initials={m.away.short.slice(0, 2)} hue={m.away.hue} size={22} flagCode={m.away.flagCode} />
            <span className="truncate text-label font-medium tracking-tight">
              {m.away.name}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            // Ao vivo preempta odds/placar: visualmente distinto de agendado
            // (kickoff+odds) e encerrado (placar+encerrado), e nunca "apostável".
            <span className="font-mono text-eyebrow uppercase tracking-label text-warn-fg">
              ao vivo
            </span>
          ) : isFinished && hasScore ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-mono text-label font-medium tabular-nums">
                {m.homeScore}
                <span className="px-1 text-muted-foreground">–</span>
                {m.awayScore}
              </span>
              <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2">
                encerrado
              </span>
            </div>
          ) : isFinished ? (
            // Encerrado sem placar reportado: marca o estado sem inventar 0–0
            // nem cair no "sem odd" (que sugeriria um jogo ainda apostável).
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-fg-2">
              encerrado
            </span>
          ) : m.status === "postponed" || m.status === "cancelled" ? (
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-fg-2">
              {STATUS_LABEL[m.status]}
            </span>
          ) : m.odds ? (
            <div className="flex flex-col items-end gap-1 font-mono text-body-sm tabular-nums">
              {m.odds.outcomes.map((o, i) => (
                <span key={i}>
                  <span className="text-muted-foreground">{o.label}</span>{" "}
                  {o.odd}
                </span>
              ))}
            </div>
          ) : (
            <span className="font-mono text-eyebrow text-muted-fg-2">
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
