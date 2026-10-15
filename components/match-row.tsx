import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveBadge } from "@/components/live-badge";
import { MatchModelLine } from "@/components/match-model-line";
import { TeamCrest } from "@/components/team-crest";
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
  // Alvo do passo "abra um jogo" do tour guiado (components/tour/guided-tour.tsx).
  tourTarget?: boolean;
};

const STATUS_LABEL: Record<"postponed" | "cancelled", string> = {
  postponed: "Adiado",
  cancelled: "Cancelado",
};

export function MatchRow({ m, last, listHref, backHref, tourTarget }: Props) {
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
      data-tour={tourTarget ? "match-row" : undefined}
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
            <span className="inline-flex items-center gap-1 text-meta text-accent-fg">
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
            <TeamCrest team={m.home} size={22} />
            <span className="truncate text-label font-medium tracking-tight" title={m.home.fullName}>
              {m.home.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TeamCrest team={m.away} size={22} />
            <span className="truncate text-label font-medium tracking-tight" title={m.away.fullName}>
              {m.away.name}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            // Ao vivo preempta odds/placar: visualmente distinto de agendado
            // (kickoff+odds) e encerrado (placar+encerrado), e nunca "apostável". O
            // selo AO VIVO fica só no topo (#574): aqui vai o placar parcial, quando
            // a sincronização já trouxe um, ou "—".
            m.liveScore ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-label font-medium tabular-nums">
                  {m.liveScore.home}
                  <span className="px-1 text-muted-foreground">–</span>
                  {m.liveScore.away}
                </span>
                <span className="text-meta text-muted-foreground">
                  {m.liveScore.caption}
                </span>
              </div>
            ) : (
              <span className="text-meta text-muted-foreground">—</span>
            )
          ) : isFinished && hasScore ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-mono text-label font-medium tabular-nums">
                {m.homeScore}
                <span className="px-1 text-muted-foreground">–</span>
                {m.awayScore}
              </span>
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                encerrado
              </span>
            </div>
          ) : isFinished ? (
            // Encerrado sem placar reportado: marca o estado sem inventar 0–0
            // nem cair no "sem odd" (que sugeriria um jogo ainda apostável).
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              encerrado
            </span>
          ) : m.status === "postponed" || m.status === "cancelled" ? (
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              {STATUS_LABEL[m.status]}
            </span>
          ) : m.odds ? (
            <div className="flex flex-col items-end gap-1 text-body-sm">
              {m.odds.outcomes.map((o, i) => (
                <span key={i}>
                  <span className="text-muted-foreground">{o.label}</span>{" "}
                  <span className="font-mono tabular-nums">{o.odd}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-meta text-muted-foreground">
              sem odd
            </span>
          )}
          <span className="ml-1 text-muted-fg-2">
            <ChevronRight className="size-3.5" />
          </span>
        </div>
      </div>
      {/* Base do modelo (#555): só em jogo analisável com base calculada. Linha extra
          condicional → as linhas sem `model` (e os goldens) ficam byte-idênticas. */}
      {m.model && <MatchModelLine model={m.model} className="block pt-2.5" />}
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
