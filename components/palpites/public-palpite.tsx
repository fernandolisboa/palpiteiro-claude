import Link from "next/link";
import { Info } from "lucide-react";

import { SettleableBadge } from "@/components/palpites/palpite-badges";
import { cn } from "@/lib/utils";
import type {
  PalpiteDimensionView,
  PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import { toPublicMarketCategories } from "@/lib/view/markets/public-category";
import { hardenSources } from "@/lib/view/share/source-hardening";
import {
  CVV_HELP,
  NON_OPERATOR_DISCLAIMER,
  PALPITE_DISCLAIMER,
  RISK_DISCLAIMER,
} from "@/lib/view/share/disclaimer";
import type { MatchPublicView } from "@/app/p/[id]/load-shared-palpite";

// Rótulo qualitativo da confiança — LOCAL (não importado do palpite-hero "use client").
// Firewall-safe: palavra, nunca dígito/%/meter.
const CONFIDENCE_LABEL: Record<PalpiteHeadlineView["confidence"], string> = {
  baixa: "confiança baixa",
  media: "confiança média",
  alta: "confiança alta",
};

/**
 * <PublicPalpite/> — render PÚBLICO read-only da manchete no /p/[id] (ADR 0035 §1/§5 / #384).
 * Server Component PURO (sem "use client", sem Server Action, NÃO importa PalpiteHero — que
 * arrasta analyzeBestBet). Espelha os sub-pieces firewall-clean do PopulatedHero (palpite-
 * hero.tsx): veredito, ProbableScore/recibo gateado por badge+finalScore, narrativa,
 * citedMarkets NORMALIZADOS (categoria, nunca linha), DimensionScorecard, fontes ENDURECIDAS
 * (hostname + nofollow), confiança palavra-chip, e os 3 blocos de disclaimer + selo 18+ + CVV.
 *
 * FIREWALL (ADR 0035 §5, regulatório): ZERO número de valor — sem odds/EV/edge/stake/Yield/
 * R$/%/timestamp de geração/CTA paga. O que sai: veredito/confiança-palavra/narrativa/placar
 * provável/times/dimensões/badge/fontes endurecidas + o placar real GATEADO (só finished).
 * Mobile-first single-column (links de share abrem no celular).
 */
export function PublicPalpite({
  view,
  match,
}: {
  view: PalpiteHeadlineView;
  match: MatchPublicView;
}) {
  const settled = view.badge !== null;
  const categories = toPublicMarketCategories(view.citedMarkets);
  const sources = hardenSources(view.sources);

  return (
    <section
      aria-label="palpite"
      className="flex flex-col gap-4 rounded-xl border border-palpite-border bg-palpite-soft/40 p-5 ring-1 ring-palpite-border/40 lg:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
          {match.homeTeam} x {match.awayTeam}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Kicker />
          {settled ? (
            <SettleableBadge state={{ kind: "settled", result: view.badge! }} />
          ) : (
            <ConfidenceChip confidence={view.confidence} />
          )}
        </div>
      </div>

      {/* Veredito + placar agrupados (uma fala). */}
      <div className="flex flex-col gap-2">
        <p className="max-w-reading text-balance text-display-lg font-medium leading-[1.08] tracking-tight text-foreground lg:text-[40px]">
          {view.verdict}
        </p>
        {settled ? (
          <SettledReceipt
            probableScore={view.probableScore}
            finalScore={match.finalScore}
          />
        ) : (
          <ProbableScore score={view.probableScore} />
        )}
      </div>

      {/* Narrativa vazia = cortada pelo guard de texto público no loader (#438). */}
      {view.narrative !== "" && (
        <p className="max-w-reading text-body leading-relaxed tracking-tight text-muted-foreground">
          {view.narrative}
        </p>
      )}

      {categories.length > 0 && (
        <p className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
          a partir de: {categories.join(" · ")}
        </p>
      )}

      <DimensionScorecard dimensions={view.dimensions} />

      <PublicCitedSources sources={sources} />

      {/* Disclaimers públicos (ADR 0035 §10): 3 blocos + selo 18+ + CVV. Single-sourced. */}
      <div className="mt-1 flex flex-col gap-2 border-t border-palpite-border/40 pt-3">
        <p className="flex items-center gap-1.5 text-eyebrow-xs tracking-tight text-muted-fg-2">
          <Info className="size-3 shrink-0" aria-hidden="true" />
          {PALPITE_DISCLAIMER}
        </p>
        <p className="text-body-sm leading-relaxed tracking-tight text-muted-foreground">
          {RISK_DISCLAIMER}
        </p>
        <p className="text-body-sm leading-relaxed tracking-tight text-muted-foreground">
          {NON_OPERATOR_DISCLAIMER}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-eyebrow-xs tracking-tight text-muted-fg-2">
          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono uppercase tracking-label">
            18+
          </span>
          <a
            href={CVV_HELP.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-sm underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {CVV_HELP.label}
          </a>
        </p>
      </div>

      {/* CTA de conversão (ADR 0035-safe, #444): registro muted, ZERO linguagem de valor — só
          um convite a entrar no app (`/` é a landing pública/estática). É a única ponta de
          crescimento no dead-end do unfurl; firewall-clean por construção (copy sem odds/EV/
          stake/R$/%) e coberta pelo teste de firewall deste componente. */}
      <Link
        href="/"
        className="mt-1 w-fit rounded-sm text-body-sm font-medium tracking-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Peça o palpite do seu jogo →
      </Link>
    </section>
  );
}

function Kicker() {
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-palpite-soft px-2.5 py-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-palpite-strong-fg">
      O Palpite
    </span>
  );
}

function ConfidenceChip({
  confidence,
}: {
  confidence: PalpiteHeadlineView["confidence"];
}) {
  const label = CONFIDENCE_LABEL[confidence];
  return (
    <span
      aria-label={label}
      className="inline-flex items-center rounded-full border border-palpite-border/70 px-2.5 py-0.5 font-mono text-eyebrow uppercase tracking-label text-palpite-fg"
    >
      {label}
    </span>
  );
}

function ProbableScore({ score }: { score: { home: number; away: number } }) {
  return (
    <p className="flex items-baseline gap-2">
      <ScoreLabel>provável</ScoreLabel>
      <ScoreDigits home={score.home} away={score.away} />
    </p>
  );
}

// Recibo settled: placar provável + placar real (FATO do mundo, firewall-safe), só quando
// finalScore gateado (status==='finished') está presente.
function SettledReceipt({
  probableScore,
  finalScore,
}: {
  probableScore: { home: number; away: number };
  finalScore: { home: number; away: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <p className="flex items-baseline gap-2">
        <ScoreLabel>provável</ScoreLabel>
        <ScoreDigits home={probableScore.home} away={probableScore.away} />
      </p>
      {finalScore && (
        <p className="flex items-baseline gap-2">
          <ScoreLabel>placar real</ScoreLabel>
          <span className="font-mono text-display-sm font-medium tabular-nums tracking-tight text-foreground">
            {finalScore.home}
            <span className="px-1 text-muted-foreground">–</span>
            {finalScore.away}
          </span>
        </p>
      )}
    </div>
  );
}

function ScoreLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-label tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function ScoreDigits({ home, away }: { home: number; away: number }) {
  return (
    <span className="font-mono text-display-sm font-medium tabular-nums tracking-tight text-palpite-strong-fg">
      {home}
      <span className="px-1 text-muted-foreground">–</span>
      {away}
    </span>
  );
}

function DimensionScorecard({
  dimensions,
}: {
  dimensions: PalpiteDimensionView[];
}) {
  if (dimensions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label tracking-tight text-muted-foreground">
        e ainda
      </span>
      <ul className="flex flex-wrap gap-2">
        {dimensions.map((d, i) => (
          <li
            key={`${d.label}-${i}`}
            className="inline-flex items-center gap-2 rounded-full border border-palpite-border/60 bg-palpite-soft/40 px-3 py-1"
          >
            <span className="text-body-sm tracking-tight text-foreground">
              {d.label}
            </span>
            <SettleableBadge
              state={
                d.badge === null
                  ? { kind: "pending" }
                  : { kind: "settled", result: d.badge }
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Fontes ENDURECIDAS (ADR 0035 §8): hostname-only display + título, rel nofollow. Esconde
// a seção inteira quando vazio (sem fontes ou todas droppadas pelo firewall/https).
function PublicCitedSources({
  sources,
}: {
  sources: ReturnType<typeof hardenSources>;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label tracking-tight text-muted-foreground">
        o palpite leu
      </span>
      <ul className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
        {sources.map((s, i) => (
          <li key={`${s.href}-${i}`} className="flex items-baseline gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="hidden text-muted-fg-2 sm:inline">
                ·
              </span>
            )}
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={cn(
                "rounded-sm text-body-sm tracking-tight text-palpite-strong-fg underline decoration-palpite-border underline-offset-2",
                "hover:decoration-palpite-strong-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palpite-border",
              )}
            >
              <span className="font-medium">{s.title}</span>
              <span className="ml-1.5 text-muted-fg-2">{s.hostname}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
