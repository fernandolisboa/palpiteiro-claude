import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LiveBadge } from "@/components/live-badge";
import { LiveScoreRefresh } from "@/components/live-score-refresh";
import { TeamCrest } from "@/components/team-crest";
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
  // Jogo acompanhado ao vivo (#580, modo ao vivo ligado, apito passado): mostra
  // "Atualizar placar" e, sem placar ao vivo utilizável, a `note` no lugar da legenda.
  // Ausente (default) = o cabeçalho de antes.
  live?: { note: string | null } | null;
};

// Expulsões ao lado do nome (#580): o cartão vermelho como um retângulo pequeno, nas
// cores de derrota que já existem (form-loss), e a contagem em mono.
function RedCards({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      aria-label={count === 1 ? "1 expulso" : `${count} expulsos`}
    >
      <span aria-hidden className="bg-form-loss-fg h-3 w-2 rounded-xs" />
      <span aria-hidden className="text-form-loss-fg font-mono text-meta tabular-nums">
        {count}
      </span>
    </span>
  );
}

// Bloco de um time: vertical no mobile (avatar em cima, nome centrado), linha no
// desktop (avatar à esquerda, nome + rótulo casa/visitante à direita). O rótulo
// (literal de apresentação; i18n é #323) só aparece no desktop. 22px do nome é um
// outlier heroic sem degrau na escala (ADR 0029) — preservado em lg:.
function TeamBlock({
  team,
  role,
  href,
  red = 0,
}: {
  team: MatchHeroView["home"];
  role: string;
  href?: string;
  red?: number;
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
      <TeamCrest team={team} size={56} priority />
      <div className="flex flex-col items-center lg:items-start">
        <span className="inline-flex items-center gap-1.5 text-center text-body font-medium leading-tight tracking-tight lg:text-left lg:text-display-xs lg:tracking-[-0.02em]">
          {name}
          {red > 0 && <RedCards count={red} />}
        </span>
        <span className="hidden text-meta uppercase tracking-label text-muted-foreground lg:inline">
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
  live = null,
}: Props) {
  const { home, away, league, when, countdown, venue, liveScore } = view;
  // O provider já deu o fim (o sync ainda não virou o jogo): sem o selo "ao vivo".
  const showLiveBadge = status === "live" && !liveScore?.ended;
  return (
    // Sem gutter próprio: o PageContainer da página dá o `px-5`/`lg:px-8` (#576).
    <div className="pt-4 pb-2 lg:pt-6">
      <div className="flex items-center justify-between pb-4 lg:justify-start lg:gap-3 lg:pb-5">
        <Badge
          variant="outline"
          className="h-5 rounded-full px-2 text-meta uppercase tracking-label text-muted-foreground"
        >
          {LEAGUE_LABEL[league]}
        </Badge>
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          {showLiveBadge && <LiveBadge />}
          <span className="font-mono tabular-nums">{when}</span>
        </div>
        {countdown && (
          <span className="hidden font-mono text-meta tabular-nums text-accent-fg lg:inline">
            {countdown}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 lg:flex lg:items-center lg:gap-8">
        <TeamBlock
          team={home}
          role="mandante"
          href={homeHref}
          red={liveScore?.red?.home ?? 0}
        />
        <div className="flex flex-col items-center gap-0.5">
          {score ? (
            <span className="font-mono text-display-md font-medium leading-none tabular-nums tracking-tight lg:text-display-lg">
              {score.home}
              <span className="px-1.5 text-muted-foreground lg:px-2">–</span>
              {score.away}
            </span>
          ) : liveScore ? (
            // Placar PARCIAL de jogo ao vivo (#574): nunca vira `score` (que é o
            // final e alimenta o recibo/liquidação).
            <span className="font-mono text-display-md font-medium leading-none tabular-nums tracking-tight lg:text-display-lg">
              {liveScore.home}
              <span className="px-1.5 text-muted-foreground lg:px-2">–</span>
              {liveScore.away}
            </span>
          ) : (
            <span className="text-display-sm font-medium text-muted-foreground tracking-tight lg:text-display-xs">
              vs
            </span>
          )}
          {score ? (
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              encerrado
            </span>
          ) : liveScore ? (
            <span className="text-center text-meta text-muted-foreground">
              {liveScore.caption}
            </span>
          ) : live?.note ? (
            <span className="text-center text-meta text-muted-foreground">
              {live.note}
            </span>
          ) : null}
          {live && <LiveScoreRefresh />}
          {countdown && (
            <span className="pt-1 font-mono text-meta tabular-nums text-accent-fg lg:hidden">
              {countdown}
            </span>
          )}
        </div>
        <TeamBlock
          team={away}
          role="visitante"
          href={awayHref}
          red={liveScore?.red?.away ?? 0}
        />
      </div>

      {venue && (
        <div className="flex items-center justify-center gap-1.5 pt-4 text-meta uppercase tracking-label text-muted-foreground lg:justify-start lg:gap-4 lg:pt-5">
          <span>{venue}</span>
        </div>
      )}
    </div>
  );
}
