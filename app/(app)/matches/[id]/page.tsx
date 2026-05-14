import { notFound } from "next/navigation";
import { Ban, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { AppBar } from "@/components/app/app-bar";
import { MatchHero } from "@/components/app/match-hero";
import { OddsCard } from "@/components/app/odds-card";
import { AnalyzeCTA } from "@/components/app/analyze-cta";
import { ThinkingCard } from "@/components/app/thinking-card";
import { AnalysisCard } from "@/components/app/analysis-card";
import { DataSections } from "@/components/app/data-sections";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { RecBadge } from "@/components/ui/rec-badge";
import {
  findAnalysisForMatch,
  findMatch,
  matchDetail,
} from "@/lib/mock-data";

type DetailState =
  | "idle"
  | "thinking"
  | "result"
  | "pass"
  | "existing"
  | "error"
  | "no-odds";

type SearchParams = Promise<{ state?: string }>;

function isDetailState(s: string | undefined): s is DetailState {
  return (
    s === "idle" ||
    s === "thinking" ||
    s === "result" ||
    s === "pass" ||
    s === "existing" ||
    s === "error" ||
    s === "no-odds"
  );
}

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const match = findMatch(id);
  if (!match) notFound();

  const defaultState: DetailState = match.prediction ? "existing" : "idle";
  const state: DetailState = isDetailState(sp.state) ? sp.state : defaultState;

  const detail = matchDetail[id] ?? matchDetail.m1;
  const analysisVariant =
    state === "pass" ? "pass" : state === "existing" ? "existing" : "result";
  const analysis = findAnalysisForMatch(id, analysisVariant);

  const showOdds = state !== "no-odds";

  return (
    <>
      <AppBar backHref="/matches" showShare />
      <main className="s-body">
        <header
          className="s-page-h s-page-h--with-back"
          style={{ marginBottom: -4 }}
        >
          <div />
          <div>
            <Eyebrow>{match.leagueFull}</Eyebrow>
            <div className="s-page-h__meta">
              {match.kickoffFull}
              {match.kickoffWithin24h && match.kickoffRel && (
                <span className="s-page-h__countdown">
                  {" "}
                  · {match.kickoffRel}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="s-detail-layout">
          <div className="s-detail-main">
            <MatchHero match={match} />

            {state === "no-odds" && (
              <div className="s-state">
                <span className="s-state__icon">
                  <Ban size={18} />
                </span>
                <div>
                  <div className="s-state__title">Sem odds disponíveis</div>
                  <div className="s-state__desc">
                    The Odds API ainda não retornou cotações para esta partida.
                    Sem odds não dá pra calcular edge — análise indisponível.
                  </div>
                </div>
              </div>
            )}

            {state === "idle" && (
              <AnalyzeCTA analyzeHref={`/matches/${id}?state=thinking`} />
            )}
            {state === "thinking" && (
              <ThinkingCard stage="Pesando forma recente e H2H" />
            )}
            {(state === "result" || state === "existing" || state === "pass") && (
              <AnalysisCard
                analysis={analysis}
                reanalyzeHref={
                  state === "existing"
                    ? `/matches/${id}?state=thinking`
                    : undefined
                }
              />
            )}
            {state === "error" && (
              <section className="s-state s-state--error">
                <span className="s-state__icon">
                  <TriangleAlert size={20} />
                </span>
                <div>
                  <div className="s-state__title">Falha na análise</div>
                  <div className="s-state__desc">
                    A chamada ao modelo retornou erro de validação. Tente
                    novamente — se persistir, a quota do dia pode estar no
                    limite.
                  </div>
                </div>
                <Button kind="secondary" size="sm" icon={RefreshCw}>
                  Tentar de novo
                </Button>
              </section>
            )}

            <DataSections match={match} detail={detail} layout="desktop" />
          </div>

          <div className="s-detail-aside">
            {showOdds && <OddsCard odds={match.odds} capturedMinutesAgo={3} />}

            <div className="s-aside-card">
              <div className="s-aside-card__h">Resumo</div>
              <div className="s-aside-card__stat">
                <span>liga</span>
                <span style={{ color: "var(--fg-2)" }}>
                  {match.league === "BSA" ? "Brasileirão" : "Champions"}
                </span>
              </div>
              <div className="s-aside-card__stat">
                <span>local</span>
                <span style={{ color: "var(--fg-2)" }}>
                  {match.venue.split("·")[0].trim()}
                </span>
              </div>
              <div className="s-aside-card__stat">
                <span>status</span>
                <span style={{ color: "var(--fg-2)" }}>agendado</span>
              </div>
              {(state === "result" ||
                state === "existing" ||
                state === "pass") && (
                <div className="s-aside-card__stat">
                  <span>recomendação</span>
                  <span>
                    <RecBadge rec={analysis.rec} size="sm" />
                  </span>
                </div>
              )}
            </div>

            <div className="s-note">
              <Info size={13} />
              <span>
                Apostas reais acontecem fora do app. O Palpiteiro só registra a
                recomendação.
              </span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
