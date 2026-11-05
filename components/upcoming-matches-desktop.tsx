"use client";

import { useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LiveBadge } from "@/components/live-badge";
import { AnalyzedBadge } from "@/components/match-list/analyzed-badge";
import {
  RowAnalyzeChip,
  showsAnalyzed,
  useRowAnalysis,
} from "@/components/match-list/row-analyze";
import { RowPalpiteSummary } from "@/components/match-list/row-palpite";
import { RowProgressTicker } from "@/components/match-list/row-progress";
import type { ProgressMascot } from "@/lib/brand/progress-mascot";
import {
  DEFAULT_LIST_ANALYZE_PLACEMENT,
  type ListAnalyzePlacement,
} from "@/lib/view/list-analyze-placement";
import { cn } from "@/lib/utils";
import { DayHeading } from "@/components/match-list/day-heading";
import { RowTrailing } from "@/components/match-list/row-trailing";
import { MatchTags } from "@/components/match-list/match-tags";
import { MatchModelLine } from "@/components/match-model-line";
import { TeamCrest } from "@/components/team-crest";
import { appendBackParam } from "@/lib/view/back-href";
import { LEAGUE_LABEL } from "@/lib/format";
import { tourMatchIndex } from "@/lib/tour/steps";
import {
  canAnalyzeFromList,
  groupByDay,
  matchRowPhase,
  showsRowLiveBadge,
} from "@/lib/view/match-list";
import type { MatchListRowView } from "@/lib/view/types";

const INITIAL_BATCH = 15;
const BATCH_STEP = 15;

// Liga + hora · jogo · odds/estado · chevron (#577). Sem coluna de status nem
// cabeçalho de grade: o dia vira a faixa do grupo e o estado vai no lado direito.
export const UPCOMING_GRID = "grid-cols-[132px_1fr_auto_24px]";
// Com o "analisar" no lugar da setinha (/admin/ia), a última coluna cabe o botão.
const UPCOMING_GRID_SIDE = "grid-cols-[132px_1fr_auto_32px]";

export function UpcomingMatchesDesktop({
  matches,
  listHref,
  endNote,
  analyzeEnabled = false,
  placement = DEFAULT_LIST_ANALYZE_PLACEMENT,
  mascot,
}: {
  matches: MatchListRowView[];
  // URL filtrada da lista de origem (/jogos?…) pra preservar o estado de busca
  // ao abrir um jogo e voltar. Ausente → link de detalhe limpo.
  listHref?: string;
  // Aviso no fim da lista cortada no teto da query, quando tudo já foi revelado.
  endNote?: string;
  // "analisar" na linha (flag do fan-out ligada). Desligado, a linha não oferece o botão.
  analyzeEnabled?: boolean;
  // Onde fica o "analisar" (/admin/ia) e o personagem do progresso.
  placement?: ListAnalyzePlacement;
  mascot?: ProgressMascot;
}) {
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const slice = matches.slice(0, visible);
  // Alvo do tour e reveal na lista PLANA; só depois agrupa por dia (mesma regra do
  // celular).
  const tourId = slice[tourMatchIndex(slice)]?.id;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {groupByDay(slice).map((group, gi) => (
        <section
          key={`${group.key}-${gi}`}
          className={gi === 0 ? undefined : "border-t border-border-subtle"}
        >
          <DayHeading label={group.label} variant="band" />
          {group.rows.map((m, i, arr) => (
            <DesktopMatchRow
              key={m.id}
              m={m}
              href={appendBackParam(`/match/${m.id}`, listHref, "/jogos")}
              last={i === arr.length - 1}
              tourTarget={m.id === tourId}
              analyzeEnabled={analyzeEnabled}
              placement={placement}
              mascot={mascot}
            />
          ))}
        </section>
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
      {visible >= matches.length && endNote && (
        <p className="border-t border-border-subtle px-5 py-3 text-center text-body-sm text-muted-foreground">
          {endNote}
        </p>
      )}
    </Card>
  );
}

function DesktopMatchRow({
  m,
  href,
  last,
  tourTarget,
  analyzeEnabled,
  placement,
  mascot,
}: {
  m: MatchListRowView;
  href: string;
  last: boolean;
  tourTarget: boolean;
  analyzeEnabled: boolean;
  placement: ListAnalyzePlacement;
  mascot?: ProgressMascot;
}) {
  const phase = matchRowPhase(m);
  const liveBadge = showsRowLiveBadge(m);
  const canAnalyze = analyzeEnabled && canAnalyzeFromList(m);
  const analysis = useRowAnalysis(m.id, canAnalyze);
  const busy =
    analysis.state.kind === "running" || analysis.state.kind === "error";
  // O palpite no meio da linha; sem ele (palpite sem manchete), o selo "analisado".
  const palpite = showsAnalyzed(analysis.state, m.hasPrediction)
    ? (m.palpite ?? null)
    : null;
  const chip = (look: "icon" | "block") => (
    <RowAnalyzeChip
      look={look}
      state={analysis.state}
      onStart={analysis.start}
      hasPrediction={m.hasPrediction}
      canAnalyze={canAnalyze}
    />
  );
  return (
    // Linha clicável inteira pelo link "esticado" (o ::after cobre a linha): o botão
    // "analisar" fica fora do <a> (botão dentro de link é HTML inválido) e acima dele.
    // Com o "ver progresso" aberto, a linha fica marcada: diz de qual jogo é o popover.
    <div
      data-tour={tourTarget ? "match-row" : undefined}
      className={cn(
        "relative grid items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:ring-inset",
        "has-[[data-progress-trigger][data-state=open]]:bg-surface-2 has-[[data-progress-trigger][data-state=open]]:shadow-[inset_3px_0_0_var(--color-palpite-strong-fg)]",
        analyzeEnabled && placement === "lateral" ? UPCOMING_GRID_SIDE : UPCOMING_GRID,
        !last && "border-b border-border-subtle"
      )}
    >
      <div className="flex flex-col items-start gap-1">
        {liveBadge ? (
          // Ao vivo (#385, #574): o selo no lugar da hora, uma vez por linha.
          <span className="text-meta font-medium">
            <LiveBadge />
          </span>
        ) : (
          <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
            {m.startsIn ?? m.time}
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
      {/* Os times à esquerda; no meio, entre eles e as odds: o andamento do run (ou o
          erro) e, fora do run, o palpite já feito. */}
      <div className="flex min-w-0 items-center gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-3">
            <IntentLink
              href={href}
              className="flex min-w-0 flex-col gap-1.5 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              <div className="flex min-w-0 items-center gap-2">
                <TeamCrest team={m.home} size={22} />
                <span
                  className="relative z-10 truncate text-label font-medium tracking-tight"
                  title={m.home.fullName}
                >
                  {m.home.name}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <TeamCrest team={m.away} size={22} />
                <span
                  className="relative z-10 truncate text-label font-medium tracking-tight"
                  title={m.away.fullName}
                >
                  {m.away.name}
                </span>
              </div>
            </IntentLink>
            {/* "analisado" ao lado dos nomes (#577), só quando não há palpite pra mostrar
                no meio; também em jogo encerrado já analisado (#99). */}
            {showsAnalyzed(analysis.state, m.hasPrediction) &&
              !palpite &&
              !busy && <AnalyzedBadge />}
          </div>
          {/* Etiquetas de mesa de amigos (ADR 0070), na mesma ordem do celular. */}
          {m.tags && (
            <MatchTags tags={m.tags} className="relative z-10 w-fit" />
          )}
          {/* Base do modelo (#555): só probabilidade, abaixo dos nomes. */}
          {m.model && <MatchModelLine model={m.model} />}
        </div>
        {busy ? (
          <RowProgressTicker
            state={analysis.state}
            teams={{ home: m.home, away: m.away }}
            mascot={mascot}
            className="ml-auto w-[300px] max-w-[50%] shrink"
          />
        ) : (
          palpite && (
            <RowPalpiteSummary
              palpite={palpite}
              href={href}
              className="ml-auto w-[300px] max-w-[50%] shrink"
            />
          )
        )}
      </div>
      <div className="flex flex-col items-end">
        <div className="flex flex-col items-stretch gap-2">
          <RowTrailing m={m} />
          {placement === "embaixo" && chip("block")}
        </div>
      </div>
      <span className="justify-self-end text-muted-fg-2">
        {phase === "finished" || phase === "off" ? null : placement ===
            "lateral" &&
          (canAnalyze || analysis.state.kind === "running") ? (
          chip("icon")
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5" />
        )}
      </span>
    </div>
  );
}
