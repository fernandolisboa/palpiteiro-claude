import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";
import type { OutcomeResult } from "@/lib/settlement/compute";

import { OverrideForm } from "./override-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] tabular-nums">{value}</span>
    </div>
  );
}

export default async function AdminPredictionPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getPredictionForOverride(id);
  if (!row) notFound();
  const { prediction, match, outcome } = row;

  const defaultResult: OutcomeResult = outcome?.result ?? "void";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <Link
          href={`/match/${match.id}`}
          className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogo</span>
        </Link>

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">
          Override de settlement
        </h1>
        <p className="pb-6 font-mono text-[11px] text-muted-foreground">
          prediction · {prediction.id.slice(0, 8)}
        </p>

        <section className="pb-8">
          <Row
            label="jogo"
            value={`${match.homeTeam} vs ${match.awayTeam}`}
          />
          <Row label="liga" value={LEAGUE_LABEL[leagueToKey(match.league)]} />
          <Row label="status do jogo" value={match.status} />
          <Row
            label="placar (provider)"
            value={
              match.homeScore !== null && match.awayScore !== null
                ? `${match.homeScore}-${match.awayScore}`
                : "—"
            }
          />
          <Row label="recomendação" value={prediction.recommendation} />
          <Row
            label="odd de entrada"
            value={prediction.oddAtRecommendation ?? "—"}
          />
          <Row label="stake (u)" value={prediction.stakeUnits} />
        </section>

        <section className="pb-8">
          <h2 className="pb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            outcome atual
          </h2>
          {outcome ? (
            <>
              <Row label="resultado" value={outcome.result} />
              <Row label="profit (u)" value={outcome.profitUnits} />
              <Row label="gols (90')" value={String(outcome.totalGoals)} />
              <Row
                label="liquidado em"
                value={outcome.settledAt.toISOString()}
              />
              <Row
                label="override manual"
                value={outcome.overrideByUserId ? "sim" : "não"}
              />
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Ainda pendente (sem outcome).
            </p>
          )}
        </section>

        <section>
          <h2 className="pb-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            novo override
          </h2>
          <OverrideForm
            predictionId={prediction.id}
            defaultResult={defaultResult}
          />
        </section>
      </div>
    </div>
  );
}
