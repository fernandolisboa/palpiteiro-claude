"use client";

import { useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveBadge } from "@/components/live-badge";
import { AnalyzedBadge } from "@/components/match-list/analyzed-badge";
import {
  RowAnalyzeChip,
  RowAnalyzeStatus,
  showsAnalyzed,
  useRowAnalysis,
} from "@/components/match-list/row-analyze";
import { AnalyzedMenu } from "@/components/match-list/row-palpite";
import { RowProgressSheet } from "@/components/match-list/row-progress";
import type { ProgressMascot } from "@/lib/brand/progress-mascot";
import { RowTrailing } from "@/components/match-list/row-trailing";
import { MatchTags } from "@/components/match-list/match-tags";
import { MatchModelLine } from "@/components/match-model-line";
import { TeamCrest } from "@/components/team-crest";
import { appendBackParam } from "@/lib/view/back-href";
import { canAnalyzeFromList, showsRowLiveBadge } from "@/lib/view/match-list";
import { cn } from "@/lib/utils";
import { LEAGUE_LABEL } from "@/lib/format";
import type { ListPalpiteView, MatchRowView } from "@/lib/view/types";

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
  // "analisar" na linha (/jogos com a flag do fan-out ligada). Ausente → só o
  // "analisado", como no /time.
  analyzeEnabled?: boolean;
  // O palpite já feito (/jogos): vai no menu do "analisado". Ausente = só o menu.
  palpite?: ListPalpiteView | null;
  // Personagem do progresso (/admin/ia).
  mascot?: ProgressMascot;
};

// Linha da lista de jogos no celular e no /time (#577). Em cima, a hora (ou AO VIVO,
// no lugar dela) e a liga; à direita, "analisado" (no celular ele não disputa a
// largura das odds). No meio, os times e o lado direito por fase (RowTrailing: odds
// lado a lado, placar, adiado). Embaixo, a linha do modelo quando há base.
export function MatchRow({
  m,
  last,
  listHref,
  backHref,
  tourTarget,
  timeLabel,
  analyzeEnabled = false,
  palpite = null,
  mascot,
}: Props) {
  // /time/[team] (#408) passa o backHref pronto; /jogos passa listHref e deriva o
  // back via appendBackParam (base /jogos). Mutuamente exclusivos na prática.
  const href = backHref
    ? `/match/${m.id}?back=${encodeURIComponent(backHref)}`
    : appendBackParam(`/match/${m.id}`, listHref, "/jogos");
  const isLive = showsRowLiveBadge(m);
  const canAnalyze = analyzeEnabled && canAnalyzeFromList(m);
  const analysis = useRowAnalysis(m.id, canAnalyze);
  const [progressOpen, setProgressOpen] = useState(false);
  const running = analysis.state.kind === "running";
  const analyzed = showsAnalyzed(analysis.state, m.hasPrediction);
  return (
    // Linha clicável inteira pelo link "esticado" (o ::after cobre a linha): o botão
    // "analisar" fica fora do <a> (botão dentro de link é HTML inválido) e acima dele.
    <div
      data-tour={tourTarget ? "match-row" : undefined}
      className={cn(
        "relative block px-5 py-3.5 transition-colors hover:bg-surface-2 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:ring-inset",
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
        {/* À direita do cabeçalho, acima das odds (Fernando, 2026-11-05): a ação
            ("analisar" / "analisando" / "tentar de novo"), ou "analisado" com o ↻ de
            reanalisar grudado. Tocar em "analisando" abre as etapas. */}
        {!running && analyzed ? (
          canAnalyze ? (
            <AnalyzedMenu
              palpite={palpite}
              href={href}
              onReanalyze={analysis.start}
            />
          ) : (
            <AnalyzedBadge />
          )
        ) : (
          <RowAnalyzeChip
            state={analysis.state}
            onStart={analysis.start}
            onShowProgress={() => setProgressOpen(true)}
            hasPrediction={m.hasPrediction}
            canAnalyze={canAnalyze}
          />
        )}
        <RowProgressSheet
          state={analysis.state}
          teams={{ home: m.home, away: m.away }}
          mascot={mascot}
          open={progressOpen}
          onOpenChange={setProgressOpen}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <IntentLink
          href={href}
          className="flex min-w-0 flex-col gap-1 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
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

        <div className="flex shrink-0 items-center gap-2">
          <RowTrailing m={m} />
          <span className="text-muted-fg-2">
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </span>
        </div>
      </div>
      <RowAnalyzeStatus state={analysis.state} className="pt-2" />
      {/* Etiquetas de mesa de amigos (ADR 0070): linha própria, pra não disputar a
          largura do cabeçalho com a liga e o "analisado" no celular. */}
      {m.tags && <MatchTags tags={m.tags} className="relative z-10 w-fit pt-2" />}
      {/* Base do modelo (#555): só em jogo analisável com base calculada. */}
      {m.model && <MatchModelLine model={m.model} className="block pt-2" />}
    </div>
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
