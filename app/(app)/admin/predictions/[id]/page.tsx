import { getSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";

import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";

import { OverrideForm } from "./override-form";
import { RevisitRefresh } from "@/components/revisit-refresh";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <DefinitionRow
      label={
        <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
          {label}
        </span>
      }
      value={<span className="text-body tabular-nums">{value}</span>}
    />
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPredictionPage({ params }: PageProps) {
  const { id } = await params;
  // Role checado na própria página, não só no layout: o App Router pode renderizar o
  // segmento da página sem re-rodar o layout (auditoria de segurança 2026-11-01).
  if ((await getSession())?.user?.role !== "admin") notFound();
  if (!UUID_RE.test(id)) notFound();
  const row = await getPredictionForOverride(id);
  if (!row) notFound();
  const { prediction, match, outcome } = row;

  // O OverrideForm agora oferece todas as opções do OutcomeResult incl. push
  // (#168), então o outcome atual (qualquer resultado) vira o default direto; sem
  // outcome → "void".
  const defaultResult = outcome?.result ?? "void";

  return (
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: `/match/${match.id}`, label: "jogo" }}
          title="Override de settlement"
          subtitle={`prediction · ${prediction.id.slice(0, 8)}`}
        />

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
          <h2 className="pb-2 font-mono text-meta uppercase tracking-label text-muted-foreground">
            outcome atual
          </h2>
          {outcome ? (
            <>
              <Row label="resultado" value={outcome.result} />
              <Row label="profit (u)" value={outcome.profitUnits} />
              <Row
                label="gols (90')"
                value={String(outcome.resultData?.totalGoals ?? "—")}
              />
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
            <p className="text-body text-muted-foreground">
              Ainda pendente (sem outcome).
            </p>
          )}
        </section>

        <section>
          <h2 className="pb-4 font-mono text-meta uppercase tracking-label text-muted-foreground">
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
