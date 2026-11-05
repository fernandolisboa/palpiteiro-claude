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
  RowAnalyzeStatus,
  showsAnalyzed,
  useRowAnalysis,
} from "@/components/match-list/row-analyze";
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

export function UpcomingMatchesDesktop({
  matches,
  listHref,
  endNote,
  analyzeEnabled = false,
}: {
  matches: MatchListRowView[];
  // URL filtrada da lista de origem (/jogos?…) pra preservar o estado de busca
  // ao abrir um jogo e voltar. Ausente → link de detalhe limpo.
  listHref?: string;
  // Aviso no fim da lista cortada no teto da query, quando tudo já foi revelado.
  endNote?: string;
  // "analisar" na linha (flag do fan-out ligada). Desligado, a linha não oferece o botão.
  analyzeEnabled?: boolean;
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
}: {
  m: MatchListRowView;
  href: string;
  last: boolean;
  tourTarget: boolean;
  analyzeEnabled: boolean;
}) {
  const phase = matchRowPhase(m);
  const liveBadge = showsRowLiveBadge(m);
  const canAnalyze = analyzeEnabled && canAnalyzeFromList(m);
  const analysis = useRowAnalysis(m.id, canAnalyze);
  return (
    // Linha clicável inteira pelo link "esticado" (o ::after cobre a linha): o botão
    // "analisar" fica fora do <a> (botão dentro de link é HTML inválido) e acima dele.
    <div
      data-tour={tourTarget ? "match-row" : undefined}
      className={`relative grid ${UPCOMING_GRID} items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:ring-inset ${
        last ? "" : "border-b border-border-subtle"
      }`}
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <IntentLink
            href={href}
            className="flex min-w-0 flex-col gap-1.5 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            <div className="flex min-w-0 items-center gap-2">
              <TeamCrest team={m.home} size={22} />
              <span className="relative z-10 truncate text-label font-medium tracking-tight" title={m.home.fullName}>
                {m.home.name}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <TeamCrest team={m.away} size={22} />
              <span className="relative z-10 truncate text-label font-medium tracking-tight" title={m.away.fullName}>
                {m.away.name}
              </span>
            </div>
          </IntentLink>
          {/* "analisado" ao lado dos nomes, na altura deles (#577); também em jogo
              encerrado já analisado (#99). */}
          {showsAnalyzed(analysis.state, m.hasPrediction) && <AnalyzedBadge />}
        </div>
        <RowAnalyzeStatus state={analysis.state} />
        {/* Etiquetas de mesa de amigos (ADR 0070), na mesma ordem do celular. */}
        {m.tags && <MatchTags tags={m.tags} className="relative z-10 w-fit" />}
        {/* Base do modelo (#555): só probabilidade, abaixo dos nomes. */}
        {m.model && <MatchModelLine model={m.model} />}
      </div>
      <div className="flex flex-col items-end gap-2">
        <RowTrailing m={m} />
        {/* "analisar" embaixo das odds, alinhado à direita com elas. */}
        <RowAnalyzeChip
          state={analysis.state}
          onStart={analysis.start}
          hasPrediction={m.hasPrediction}
          canAnalyze={canAnalyze}
        />
      </div>
      <span className="justify-self-end text-muted-fg-2">
        {phase === "finished" || phase === "off" ? null : (
          <ChevronRight aria-hidden="true" className="size-3.5" />
        )}
      </span>
    </div>
  );
}
