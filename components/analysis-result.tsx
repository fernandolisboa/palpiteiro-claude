import { Dot, Info, RefreshCw } from "lucide-react";

import { AnalysisScenarios } from "@/components/analysis-scenarios";
import { HelpHint } from "@/components/help-hint";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatLine } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
import type { AnalysisView, LineupRecheckView } from "@/lib/view/types";

type Props = {
  view: AnalysisView;
  // Aviso de risco no rodapé (#434). Default true → todo card sóbrio o carrega; false
  // quando o container já mostra UMA linha no fim, em vez de uma por card.
  showRiskDisclaimer?: boolean;
};

export function AnalysisResult({ view, showRiskDisclaimer = true }: Props) {
  // pass = sem recomendação (recommendation null) — data-driven, não mais via kind.
  if (view.recommendation === null && view.liveLabel) {
    return <LiveReading view={view} showRiskDisclaimer={showRiskDisclaimer} />;
  }
  if (view.recommendation === null) {
    return (
      <div className="flex flex-col rounded-lg border border-dashed border-border-strong bg-card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="flex items-center gap-1 text-meta uppercase tracking-eyebrow text-muted-foreground">
            sem vantagem clara
            <HelpHint
              anchor="recomendacao"
              label="Sem aposta"
              blurb="Sem aposta = nenhuma seleção com vantagem suficiente; é disciplina, não erro. Ter muitos jogos sem aposta (30–60%) é bom."
            />
          </span>
          <span className="font-mono tabular-nums text-meta text-muted-foreground">
            {view.generatedAt}
          </span>
        </div>
        <Separator />
        {view.lineupRecheck && <LineupRecheckNotice recheck={view.lineupRecheck} />}
        {/* O grid de stats confidence/edge saiu do card (ADR 0012): os números
            vivem no bloco de cenários com o label unificado "prob. do modelo"
            — "confidence" exibia P(over) em pass sem dizer isso. */}
        <div className="flex items-start gap-4 px-4 py-4">
          <div className="flex flex-col items-start gap-1">
            <span className="text-display-sm font-medium leading-none tracking-tight text-muted-foreground">
              Sem aposta
            </span>
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              não apostar
            </span>
          </div>
        </div>
        <p className="max-w-reading px-4 pb-4 text-body-sm leading-relaxed tracking-tight text-muted-foreground">
          Sem aposta recomendada — nenhum dos lados tem vantagem mínima de{" "}
          {view.minEdgeLabel} sobre o mercado
        </p>
        {view.outcomes.length > 0 && (
          <AnalysisScenarios
            outcomes={view.outcomes}
            framing={view.framing}
            note={view.note}
            returnTone={view.expectedReturnTone}
            minEdgePp={view.minEdgePp}
          />
        )}
        <Separator />
        <div className="px-4 py-3">
          <p className="max-w-reading text-body-sm leading-relaxed text-foreground tracking-tight">
            {view.rationale}
          </p>
          <KeyFactors items={view.factors} />
        </div>
        <AnalysisFooter view={view} showRiskDisclaimer={showRiskDisclaimer} />
      </div>
    );
  }

  const rec = view.recommendation;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-meta uppercase tracking-eyebrow text-accent-fg">
          recomendação · gerada com claude
        </span>
        <span className="font-mono tabular-nums text-meta text-muted-foreground">
          {view.generatedAt}
        </span>
      </div>
      <Separator />
      {view.lineupRecheck && <LineupRecheckNotice recheck={view.lineupRecheck} />}
      {/* O grid de stats confidence/edge saiu da row (ADR 0012): os mesmos
          números (valores salvos da row) vivem na coluna recomendada do bloco
          de cenários, com labels unificados "prob. do modelo"/"edge". O destaque
          é o outcome label completo (mercado + seleção + linha já resolvido pela
          view) — sem setas nem "2.5" hardcoded (data-driven, AC3). */}
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex flex-col items-start gap-1">
          <span className="text-display-md font-medium leading-none tracking-tight text-accent-strong-fg">
            {rec.selectionLabel}
            {rec.line !== null ? ` ${formatLine(rec.line)}` : ""}
          </span>
          <span className="text-meta uppercase tracking-label text-accent-fg">
            {rec.marketLabel}
          </span>
        </div>
      </div>
      {rec && (
        <div className="mx-4 mb-4 flex max-w-reading flex-col gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            aposta recomendada
          </span>
          {/* Frase estruturada data-driven (AC3): mercado + seleção + linha,
              todos resolvidos pela view a partir do registry. Sem string de
              mercado hardcoded no componente. */}
          <p className="text-body font-medium leading-snug tracking-tight text-foreground">
            {rec.marketLabel} · {rec.selectionLabel}
            {rec.line !== null ? ` ${formatLine(rec.line)}` : ""}
          </p>
          {/* Tradução LEIGA (lay-friendly), vinda da view (betSummary): restaura
              a frase pré-pivot "Mais de 2.5 gols — pelo menos 3 gols no jogo".
              A sub-frase `plain` só aparece quando existe (over/under). */}
          {rec.betSummary && (
            <p className="text-body-sm leading-snug tracking-tight text-muted-foreground">
              {rec.betSummary.market}
              {rec.betSummary.plain ? ` — ${rec.betSummary.plain}` : ""}
            </p>
          )}
          {view.stakeUnits && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                stake
              </span>
              <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
                {view.stakeUnits}
              </span>
            </div>
          )}
          {view.kellyInfoUnits && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                quarter-Kelly (informativo)
              </span>
              <span className="font-mono text-body tabular-nums tracking-tight text-muted-foreground">
                {view.kellyInfoUnits}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              odd na análise{view.oddAtRecAgo ? ` (${view.oddAtRecAgo})` : ""}
            </span>
            <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
              {view.oddAtRec}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                retorno esperado
              </span>
              <span
                className={cn(
                  "font-mono text-body font-medium tabular-nums tracking-tight",
                  // text-edge-fg é reservado: só no retorno positivo da
                  // recomendação (tone "positive" do view-mapper).
                  view.expectedReturnTone === "positive"
                    ? "text-edge-fg"
                    : "text-foreground",
                )}
              >
                {view.expectedReturn}
              </span>
            </div>
            {view.evLegend && (
              <p className="text-meta leading-snug tracking-tight text-muted-foreground">
                {view.evLegend}
              </p>
            )}
          </div>
          {view.minOdd && (
            <div className="flex items-baseline justify-between gap-2 border-t border-border-subtle pt-2">
              <span className="flex items-center gap-1 text-meta uppercase tracking-label text-muted-foreground">
                vale a pena se odd ≥
                <HelpHint
                  anchor="odd-minima"
                  label="odd mínima"
                  blurb="A menor odd em que a aposta ainda mantém vantagem mínima — definida pela IA. Abaixo dela, a vantagem some."
                />
              </span>
              <span className="font-mono text-label font-medium tabular-nums tracking-tight">
                {view.minOdd}
              </span>
            </div>
          )}
        </div>
      )}
      {view.outcomes.length > 0 && (
        <AnalysisScenarios
          outcomes={view.outcomes}
          framing={view.framing}
          note={view.note}
          returnTone={view.expectedReturnTone}
          minEdgePp={view.minEdgePp}
        />
      )}
      <Separator />
      <div className="px-4 py-3.5">
        <p className="max-w-reading text-body-sm leading-relaxed text-foreground tracking-tight">
          {view.rationale}
        </p>
        <KeyFactors items={view.factors} />
      </div>
      <AnalysisFooter view={view} showRiskDisclaimer={showRiskDisclaimer} />
    </Card>
  );
}

// Reconferência com a escalação (#619): selo + de onde vieram os números + o que mudou.
// Só texto e hora; as odds da linha de baixo são as da tabela de cenários do card.
function LineupRecheckNotice({ recheck }: { recheck: LineupRecheckView }) {
  const odds = recheck.oddsAt
    ? `Odds de ${recheck.oddsAt}.`
    : "Odds da análise anterior.";
  return (
    <div
      data-testid="lineup-recheck"
      className="mx-4 mt-3 flex max-w-reading flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5"
    >
      <Badge
        variant="outline"
        size="xs"
        className="border-accent-border bg-accent-soft text-accent-fg"
      >
        <RefreshCw aria-hidden="true" className="size-3" />
        Atualizado com a escalação
      </Badge>
      <p className="text-meta leading-snug tracking-tight text-muted-foreground">
        Recalculado em código às {recheck.at} com as escalações confirmadas, sem nova
        chamada de IA. {odds}
      </p>
      <p className="text-body-sm leading-snug tracking-tight text-foreground">
        Antes da escalação: {recheck.before} → agora: {recheck.after}
        {recheck.changed ? "" : " (mesma recomendação)"}
      </p>
    </div>
  );
}

function KeyFactors({ items }: { items: string[] }) {
  return (
    <ul className="flex max-w-reading flex-col gap-2 pt-4">
      <span className="text-meta uppercase tracking-label text-muted-foreground">
        fatores-chave
      </span>
      {items.map((f, i) => (
        <li
          key={i}
          className="flex items-start gap-1.5 text-body-sm text-foreground tracking-tight"
        >
          <Dot className="-ml-1 size-4 shrink-0 text-muted-fg-2" aria-hidden="true" />
          <span className="flex-1">{f}</span>
        </li>
      ))}
    </ul>
  );
}

type FooterProps = {
  view: AnalysisView;
  showRiskDisclaimer: boolean;
};

// Rodapé técnico do resultado: versão do prompt · modelo que rodou · motor · custo. O gatilho de
// reanálise NÃO vive mais aqui (#244 moveu pro rodapé da seção, SectionFooterDispatch).
// Acima da meta técnica vai o aviso de risco (#434) — footnote muda espelhando o disclaimer
// do HERO palpite (Info + text-meta), quando showRiskDisclaimer (default; o fan-out desliga
// e mostra UMA linha no fim do painel).
function AnalysisFooter({ view, showRiskDisclaimer }: FooterProps) {
  return (
    <>
      <Separator />
      {showRiskDisclaimer && (
        <p className="flex items-center gap-1.5 px-4 pt-2.5 text-meta leading-snug tracking-tight text-muted-foreground">
          <Info className="size-3 shrink-0" aria-hidden="true" />
          {ANALYSIS_RISK_DISCLAIMER}
        </p>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 font-mono text-meta text-muted-foreground tabular-nums">
        <span>
          {view.promptVersion} · {view.model} · {view.engine}
        </span>
        <span>{view.costUsd}</span>
      </div>
    </>
  );
}

// Leitura ao vivo (#594, ADR 0060): sempre sem aposta, porque não há odd ao vivo. O
// card diz o momento congelado no carimbo e que os números são as chances do modelo
// para o resultado final, com o placar e o tempo que faltam.
function LiveReading({
  view,
  showRiskDisclaimer,
}: {
  view: AnalysisView;
  showRiskDisclaimer: boolean;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-dashed border-border-strong bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
          leitura ao vivo
        </span>
        <span className="font-mono tabular-nums text-meta text-muted-foreground">
          {view.liveLabel}
        </span>
      </div>
      <Separator />
      <p className="max-w-reading px-4 py-3 text-body-sm leading-relaxed tracking-tight text-muted-foreground">
        Sem odd ao vivo, o app não recomenda aposta. As chances abaixo são do modelo
        para o resultado final, com o placar e o tempo que faltam.
      </p>
      {view.outcomes.length > 0 && (
        <ul className="mx-4 mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {view.outcomes.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2"
            >
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                {o.scenarioLabel}
              </span>
              <span className="font-mono text-body-sm font-medium tabular-nums tracking-tight text-foreground">
                {o.modelProb}
                {o.decided && (
                  <span className="pl-1.5 font-sans text-meta font-normal text-muted-foreground">
                    já decidido
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Separator />
      <div className="px-4 py-3">
        <p className="max-w-reading text-body-sm leading-relaxed text-foreground tracking-tight">
          {view.rationale}
        </p>
        <KeyFactors items={view.factors} />
      </div>
      <AnalysisFooter view={view} showRiskDisclaimer={showRiskDisclaimer} />
    </div>
  );
}
