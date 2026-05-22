"use client";

/**
 * PREVIEW-ONLY (issue #9): este client component simula o state machine
 * idle → loading → OVER/UNDER/PASS via ?state=… e via clique no CTA.
 *
 * Na issue #9 isso vira:
 *   - server component que faz fetch do match + última predição via Drizzle;
 *   - client islands isolados: <AnalyzeCTA> com useFormStatus pro botão, server
 *     action que persiste em ai_calls + predictions, error.tsx boundary pra
 *     falha de validação Zod, loading.tsx pro Suspense.
 *   - getFixtureById sai; entra getMatchById(id) tipado.
 *
 * Não construir lógica nova assumindo client-side rendering — qualquer regra
 * que tem que sobreviver à issue #9 mora em lib/, não aqui.
 *
 * Também: o id do match aqui é slug (pal-fla), na issue #9 vira UUID.
 * Não fazer split/regex sobre o id; tratar como string opaca em qualquer lugar.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, RefreshCcw, Sparkles, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnalysisResult } from "@/components/analysis-result";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { DesktopShell } from "@/components/desktop-shell";
import { FormSection } from "@/components/form-section";
import { H2HSection } from "@/components/h2h-section";
import { MatchCollapsible } from "@/components/match-collapsible";
import { MatchHero } from "@/components/match-hero";
import { OddsCard } from "@/components/odds-card";
import { StandingsSection } from "@/components/standings-section";
import { TeamAvatar } from "@/components/team-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEAGUE_LABEL, type Fixture } from "@/lib/fixtures";

type AnalysisState =
  | "idle"
  | "loading"
  | "over"
  | "under"
  | "pass"
  | "again"
  | "error"
  | "no-odds";

const REC_LABEL = { over: "OVER", under: "UNDER", pass: "PASS" } as const;

function parseState(input: string | null): AnalysisState | null {
  switch (input) {
    case "idle":
    case "loading":
    case "over":
    case "under":
    case "pass":
    case "again":
    case "error":
    case "no-odds":
      return input;
    default:
      return null;
  }
}

export function MatchScreen({ fixture }: { fixture: Fixture }) {
  const searchParams = useSearchParams();
  const previewState = parseState(searchParams.get("state"));
  const [localState, setLocalState] = useState<AnalysisState>("idle");

  const state: AnalysisState = previewState ?? localState;

  useEffect(() => {
    if (state !== "loading" || previewState === "loading") return;
    const timer = setTimeout(() => setLocalState("over"), 3000);
    return () => clearTimeout(timer);
  }, [state, previewState]);

  const handleAnalyze = () => setLocalState("loading");

  return (
    <>
      <div className="lg:hidden">
        <MobileMatch fixture={fixture} state={state} onAnalyze={handleAnalyze} />
      </div>
      <div className="hidden lg:block">
        <DesktopMatch fixture={fixture} state={state} onAnalyze={handleAnalyze} />
      </div>
    </>
  );
}

type ScreenProps = {
  fixture: Fixture;
  state: AnalysisState;
  onAnalyze: () => void;
};

function MobileMatch({ fixture, state, onAnalyze }: ScreenProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-fg-2">
            match · {fixture.id}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <MatchHero
        home={fixture.home}
        away={fixture.away}
        league={fixture.league}
        when={fixture.when}
        countdown={fixture.countdown}
        venue={fixture.venue}
      />

      <div className="flex flex-col gap-3 px-5 pb-6">
        <ResultRegion state={state} onAnalyze={onAnalyze} />
        <CollapsibleStack fixture={fixture} state={state} />
      </div>
    </div>
  );
}

function DesktopMatch({ fixture, state, onAnalyze }: ScreenProps) {
  const showResult = state === "over" || state === "under" || state === "pass" || state === "again";
  const showError = state === "error";
  const showNoOdds = state === "no-odds";
  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1100px] px-8 pt-8 pb-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <div className="grid grid-cols-[1fr_320px] gap-8 pb-8">
          <div>
            <div className="flex items-center gap-3 pb-5">
              <span className="inline-flex h-5 items-center rounded-full border border-border bg-transparent px-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {LEAGUE_LABEL[fixture.league]}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {fixture.when}
              </span>
              {fixture.countdown && (
                <span className="font-mono text-[11px] tabular-nums text-accent-fg">
                  {fixture.countdown}
                </span>
              )}
            </div>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <TeamAvatar
                  initials={fixture.home.short.slice(0, 2)}
                  hue={fixture.home.hue}
                  size={56}
                />
                <div className="flex flex-col">
                  <span className="text-[22px] font-medium tracking-[-0.02em]">
                    {fixture.home.name}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    casa
                  </span>
                </div>
              </div>
              <span className="text-[22px] font-medium text-muted-foreground tracking-tight">
                vs
              </span>
              <div className="flex items-center gap-3">
                <TeamAvatar
                  initials={fixture.away.short.slice(0, 2)}
                  hue={fixture.away.hue}
                  size={56}
                />
                <div className="flex flex-col">
                  <span className="text-[22px] font-medium tracking-[-0.02em]">
                    {fixture.away.name}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    visitante
                  </span>
                </div>
              </div>
            </div>
            {fixture.venue && (
              <div className="flex items-center gap-4 pt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-fg-2">
                <span>{fixture.venue}</span>
                <span>·</span>
                <span>Rodada 8 · Série A</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <OddsCard
              noOdds={showNoOdds}
              over={fixture.odds.over}
              under={fixture.odds.under}
            />
          </div>
        </div>

        {showResult && (
          <div className="pb-6">
            <AnalysisResult
              kind={state === "again" ? "OVER" : REC_LABEL[state]}
              again={state === "again"}
            />
          </div>
        )}

        {state === "idle" && (
          <div className="pb-6">
            <Button size="lg" className="h-12 px-6 text-[14px]" onClick={onAnalyze}>
              <Sparkles className="size-4" /> Analisar com IA
            </Button>
          </div>
        )}

        {state === "loading" && (
          <div className="pb-6">
            <AnalyzeCTA state="loading" />
          </div>
        )}

        {showError && (
          <div className="pb-6">
            <AnalysisErrorCard />
          </div>
        )}

        {showNoOdds && (
          <div className="pb-6">
            <NoOddsHint />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 pb-3">
          <MatchCollapsible title="Forma recente" meta="últimos 5" defaultOpen>
            <FormSection home={fixture.home.name} away={fixture.away.name} />
          </MatchCollapsible>
          <MatchCollapsible title="Confrontos diretos (H2H)" meta="5 jogos" defaultOpen>
            <H2HSection />
          </MatchCollapsible>
        </div>
        <div className="pb-3">
          <MatchCollapsible
            title={`Classificação · ${LEAGUE_LABEL[fixture.league]}`}
            meta="rodada 8"
            defaultOpen
          >
            <StandingsSection />
          </MatchCollapsible>
        </div>
        <div className="pb-3">
          <MatchCollapsible title="Lesões e suspensões" meta="dados indisponíveis" />
        </div>
        <MatchCollapsible title="Escalações" meta="ainda não divulgadas" />
      </div>
    </DesktopShell>
  );
}

function ResultRegion({
  state,
  onAnalyze,
}: {
  state: AnalysisState;
  onAnalyze: () => void;
}) {
  if (state === "no-odds") {
    return (
      <>
        <OddsCard noOdds />
        <NoOddsHint />
      </>
    );
  }
  if (state === "error") {
    return (
      <>
        <AnalysisErrorCard />
        <OddsCard />
      </>
    );
  }
  if (state === "loading") {
    return (
      <>
        <OddsCard />
        <AnalyzeCTA state="loading" />
      </>
    );
  }
  if (state === "over" || state === "under" || state === "pass" || state === "again") {
    const kind = state === "again" ? "OVER" : REC_LABEL[state];
    return (
      <>
        <AnalysisResult kind={kind} again={state === "again"} />
        <OddsCard />
      </>
    );
  }
  return (
    <>
      <OddsCard />
      <AnalyzeCTA state="idle" onClick={onAnalyze} />
    </>
  );
}

function CollapsibleStack({ fixture, state }: { fixture: Fixture; state: AnalysisState }) {
  return (
    <>
      <MatchCollapsible title="Forma recente" meta="últimos 5" defaultOpen>
        <FormSection home={fixture.home.name} away={fixture.away.name} />
      </MatchCollapsible>
      <MatchCollapsible title="Confrontos diretos (H2H)" meta="5 jogos">
        <H2HSection />
      </MatchCollapsible>
      <MatchCollapsible
        title={`Classificação · ${LEAGUE_LABEL[fixture.league]}`}
        meta="rodada 8"
      >
        <StandingsSection />
      </MatchCollapsible>
      <MatchCollapsible
        title="Lesões e suspensões"
        meta={state === "under" ? "2 baixas" : "dados indisponíveis"}
      />
      <MatchCollapsible title="Escalações" meta="ainda não divulgadas" />
    </>
  );
}

function AnalysisErrorCard() {
  return (
    <Card className="border-warn-border bg-card">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="pt-0.5 text-warn-fg">
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium tracking-tight">
            Falha na análise
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground tracking-tight">
            A resposta do modelo não passou na validação Zod (campo{" "}
            <span className="font-mono">edge_pp</span> ausente). Nenhum custo cobrado nesta tentativa.
          </span>
          <span className="font-mono text-[10.5px] text-muted-fg-2">
            trace · ai_call#42a8 · claude-sonnet-4.5
          </span>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="default">
              <RefreshCcw className="size-3.5" /> Tentar novamente
            </Button>
            <Button size="sm" variant="ghost">
              Reportar
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NoOddsHint() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground tracking-tight">
      <Sparkles className="size-3.5" />
      Análise indisponível enquanto não houver odds publicadas.
    </div>
  );
}
