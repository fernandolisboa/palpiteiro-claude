import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ResultBadge } from "@/components/result-badge";
import { auth } from "@/auth";
import {
  LEAGUE_LABEL,
  formatKickoffAbsolute,
  formatOdd,
  formatUnitsCompact,
  leagueToKey,
} from "@/lib/format";
import {
  getUserBetSlipsPage,
  type BetSlipHistoryRow,
  type SlipStatus,
  type UserBetLegRow,
} from "@/lib/db/queries/user-bets";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { historyLegSummary } from "@/lib/view/bet-slip";
import { betLegLabel } from "@/lib/view/free-bet";
import type { ResultState } from "@/lib/view/result-state";
import { displayMatchTeams } from "@/lib/view/team";

export const dynamic = "force-dynamic";

// Histórico "Suas apostas" (#473, ADR 0036 Fase 3). Autenticado e PRIVADO — `userId`
// vem SEMPRE do `auth()`, NUNCA de rota/query (anti-IDOR); slip é imutável e NUNCA
// compartilhável (§13), nada aqui cruza pra `/p/[id]`/OG. Cursor por `createdAt desc`,
// ~20 por página. Status DERIVADO em leitura (nunca recomputado no render). O joint
// persistido NÃO é exibido aqui: a invariante de coerência exige o joint junto das
// marginais Poisson na mesma tela, e o histórico re-renderiza só o persistido (as
// marginais são um artefato do confirm) — mostramos odd combinada + status derivado.

// Disclaimer §3 (aviso de risco) — VERBATIM. Constante LOCAL de propósito (o histórico
// nunca arrasta value-language-guard pro grafo de import).
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

// Status do slip → selo único de resultado (ADR 0056). "Não conferida" não é
// resultado: fica num selo neutro com a palavra.
const SLIP_RESULT: Partial<Record<SlipStatus, ResultState>> = {
  acertou: "won",
  errou: "lost",
  pendente: "pending",
};

type PageProps = {
  searchParams: Promise<{ cursor?: string }>;
};

export default async function ApostasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { cursor } = await searchParams;
  const page = await getUserBetSlipsPage({
    userId: session.user.id,
    cursor,
  });
  const timeZone = await getRequestTimeZone();
  const now = new Date();

  return (
    <div className="bg-background text-foreground">
      <PageContainer width="reading">
        <PageHeader
          title="Suas apostas"
          description="Registradas por você. Privado, só você vê."
        />

        {page.slips.length === 0 ? (
          <EmptyState
            icon={<Ticket className="size-6" aria-hidden />}
            title="Você ainda não registrou apostas"
            description="Abra um jogo, toque nas seleções que você apostou e registre — elas aparecem aqui."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {page.slips.map((slip) => (
              <SlipCard
                key={slip.id}
                slip={slip}
                now={now}
                timeZone={timeZone}
              />
            ))}
          </div>
        )}

        {page.nextCursor && (
          <div className="pt-6">
            <Link
              href={`/apostas?cursor=${encodeURIComponent(page.nextCursor)}`}
              className="text-meta uppercase tracking-label text-muted-foreground hover:text-foreground"
            >
              apostas mais antigas →
            </Link>
          </div>
        )}
        {cursor && (
          <div className="pt-3">
            <Link
              href="/apostas"
              className="text-meta uppercase tracking-label text-muted-foreground hover:text-foreground"
            >
              ← voltar ao topo
            </Link>
          </div>
        )}

        <p className="mt-10 text-meta leading-relaxed text-muted-foreground tracking-tight">
          {RISK_DISCLAIMER_PT_BR}
        </p>
      </PageContainer>
    </div>
  );
}

function SlipCard({
  slip,
  now,
  timeZone,
}: {
  slip: BetSlipHistoryRow;
  now: Date;
  timeZone: string;
}) {
  const teams = displayMatchTeams(
    slip.match.homeTeam,
    slip.match.awayTeam,
    leagueToKey(slip.match.league),
  );
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-body font-medium tracking-tight text-foreground">
            {teams.home} × {teams.away}
          </span>
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            {LEAGUE_LABEL[leagueToKey(slip.match.league)]} ·{" "}
            {formatKickoffAbsolute(slip.match.kickoffAt, now, timeZone)}
          </span>
        </div>
        <SlipStatusBadge status={slip.status} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        {slip.legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} />
        ))}
      </div>

      {slip.mode === "combinada" && slip.stakeUnits !== null && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            seu stake na combinada
          </span>
          <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
            {formatUnitsCompact(Number(slip.stakeUnits))}
          </span>
        </div>
      )}

      {slip.legs.length >= 2 && slip.comboUserOdd !== null && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            odd da combinada
          </span>
          <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
            {formatOdd(slip.comboUserOdd)}
          </span>
        </div>
      )}
    </Card>
  );
}

function SlipStatusBadge({ status }: { status: SlipStatus }) {
  const result = SLIP_RESULT[status];
  if (result) return <ResultBadge result={result} size="sm" />;
  return (
    <Badge variant="outline" size="sm" className="tracking-tight text-muted-foreground">
      Não conferida
    </Badge>
  );
}

// Outcome por perna re-renderizado do persistido (nunca recomputado). null = pendente
// ou não-liquidável (o badge da perna distingue via settleable).
function LegRow({ leg }: { leg: UserBetLegRow }) {
  const label = betLegLabel(leg.kind, leg.params as Record<string, unknown>);
  const result = leg.outcome?.result ?? null;
  const legResult: ResultState | null =
    result === "won" ? "won" : result === "lost" ? "lost" : leg.settleable ? "pending" : null;
  const summary = historyLegSummary(leg);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm tracking-tight text-foreground">
          {label}
        </span>
        {legResult ? (
          <ResultBadge result={legResult} />
        ) : (
          <Badge variant="outline" size="xs" className="tracking-tight text-muted-foreground">
            não conferimos
          </Badge>
        )}
      </div>
      {summary.length > 0 && (
        <span className="font-mono text-meta tabular-nums text-muted-foreground">
          {summary.join(" · ")}
        </span>
      )}
    </div>
  );
}
