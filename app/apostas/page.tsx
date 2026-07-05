import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { auth } from "@/auth";
import { LEAGUE_LABEL, formatKickoffAbsolute, leagueToKey } from "@/lib/format";
import {
  getUserBetSlipsPage,
  type BetSlipHistoryRow,
  type SlipStatus,
  type UserBetLegRow,
} from "@/lib/db/queries/user-bets";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { betLegLabel } from "@/lib/view/free-bet";

export const dynamic = "force-dynamic";

// Histórico "Minhas apostas" (#473, ADR 0036 Fase 3). Autenticado e PRIVADO — `userId`
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

const STATUS_LABEL: Record<SlipStatus, string> = {
  acertou: "Acertou",
  errou: "Errou",
  pendente: "Pendente",
  nao_conferida: "Não conferida",
};

function statusVariant(
  status: SlipStatus,
): "default" | "destructive" | "secondary" | "outline" {
  if (status === "acertou") return "default";
  if (status === "errou") return "destructive";
  if (status === "pendente") return "secondary";
  return "outline";
}

type PageProps = {
  searchParams: Promise<{ cursor?: string }>;
};

export default async function ApostasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { cursor } = await searchParams;
  const cursorDate = cursor ? new Date(cursor) : undefined;
  const page = await getUserBetSlipsPage({
    userId: session.user.id,
    cursor:
      cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : undefined,
  });
  const timeZone = await getRequestTimeZone();
  const now = new Date();

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <BackLink href="/jogos" label="jogos" />

        <h1 className="text-display-md font-medium tracking-tight">
          Minhas apostas
        </h1>
        <p className="text-muted-foreground pb-6 font-mono text-meta">
          suas apostas registradas · privado, só você vê
        </p>

        {page.slips.length === 0 ? (
          <EmptyState
            icon={<Ticket className="size-6" aria-hidden />}
            title="Você ainda não registrou apostas"
            description="Abra um jogo, escreva sua aposta e confirme — ela aparece aqui."
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
              className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground hover:text-foreground"
            >
              apostas mais antigas →
            </Link>
          </div>
        )}
        {cursor && (
          <div className="pt-3">
            <Link
              href="/apostas"
              className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2 hover:text-foreground"
            >
              ← voltar ao topo
            </Link>
          </div>
        )}

        <p className="mt-10 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
          {RISK_DISCLAIMER_PT_BR}
        </p>
      </div>
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
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-body font-medium tracking-tight text-foreground">
            {slip.match.homeTeam} × {slip.match.awayTeam}
          </span>
          <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2">
            {LEAGUE_LABEL[leagueToKey(slip.match.league)]} ·{" "}
            {formatKickoffAbsolute(slip.match.kickoffAt, now, timeZone)}
          </span>
        </div>
        <Badge variant={statusVariant(slip.status)} size="sm">
          {STATUS_LABEL[slip.status]}
        </Badge>
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        {slip.legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} />
        ))}
      </div>

      {slip.legs.length >= 2 && slip.comboUserOdd !== null && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            odd da combinada
          </span>
          <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
            {Number(slip.comboUserOdd).toFixed(2)}
          </span>
        </div>
      )}
    </Card>
  );
}

// Outcome por perna re-renderizado do persistido (nunca recomputado). null = pendente
// ou não-liquidável (o badge da perna distingue via settleable).
function LegRow({ leg }: { leg: UserBetLegRow }) {
  const label = betLegLabel(leg.kind, leg.params as Record<string, unknown>);
  const result = leg.outcome?.result ?? null;
  const legLabel =
    result === "won"
      ? "acertou"
      : result === "lost"
        ? "errou"
        : leg.settleable
          ? "pendente"
          : "não conferimos";
  const legVariant =
    result === "won"
      ? "default"
      : result === "lost"
        ? "destructive"
        : "outline";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-body-sm tracking-tight text-foreground">
        {label}
      </span>
      <Badge variant={legVariant} size="xs">
        {legLabel}
      </Badge>
    </div>
  );
}
