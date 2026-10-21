import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";

import { SlipCard } from "@/components/bets/slip-card";
import { SlipFilterChips, slipFilterHref } from "@/components/bets/slip-filter";
import { SlipsSummary } from "@/components/bets/slips-summary";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { auth } from "@/auth";
import { resolveSlipFilter, summarizeSlipLedger } from "@/lib/bets/slip-ledger";
import { getUserBetSlipLedger, getUserBetSlipsPage } from "@/lib/db/queries/user-bets";
import { getRequestTimeZone } from "@/lib/server/request-timezone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Suas apostas" };

// Histórico "Suas apostas" (#473, ADR 0036 Fase 3; resumo e filtro #577). Autenticado
// e PRIVADO — `userId` vem SEMPRE do `auth()`, NUNCA de rota/query (anti-IDOR); slip é
// imutável e NUNCA compartilhável (§13), nada aqui cruza pra `/p/[id]`/OG. Cursor por
// `createdAt desc`, ~20 por página, dentro do recorte Em aberto/Encerradas. Status
// DERIVADO em leitura. O joint persistido NÃO é exibido aqui: a invariante de
// coerência exige o joint junto das marginais Poisson na mesma tela, e o histórico
// re-renderiza só o persistido — mostramos odd combinada + status derivado.

// Disclaimer §3 (aviso de risco) — VERBATIM, uma vez na tela (ADR 0057 item 6).
// Constante LOCAL de propósito (o histórico nunca arrasta value-language-guard pro
// grafo de import).
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

const PAGER_LINK =
  "text-meta uppercase tracking-label text-muted-foreground hover:text-foreground";

type PageProps = {
  searchParams: Promise<{ cursor?: string; status?: string }>;
};

export default async function ApostasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const { cursor, status } = await searchParams;
  const now = new Date();
  const [ledger, timeZone] = await Promise.all([
    getUserBetSlipLedger(userId, now),
    getRequestTimeZone(),
  ]);
  const summary = summarizeSlipLedger(ledger);
  const filter = resolveSlipFilter(status, summary.open > 0);
  const page =
    ledger.length === 0
      ? null
      : await getUserBetSlipsPage({
          userId,
          cursor,
          slipIds: filter === "abertas" ? summary.openIds : summary.closedIds,
        });

  return (
    <div className="bg-background text-foreground">
      <PageContainer width="reading">
        <PageHeader
          title="Suas apostas"
          description="Registradas por você. Privado, só você vê."
        />

        {page === null ? (
          <EmptyState
            icon={<Ticket className="size-6" aria-hidden />}
            title="Você ainda não registrou apostas"
            description="Abra um jogo, toque nas seleções que você apostou e registre — elas aparecem aqui."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <SlipsSummary summary={summary} />
            <SlipFilterChips current={filter} />

            {page.slips.length === 0 ? (
              <EmptyState
                className="py-8"
                title={
                  filter === "abertas"
                    ? "Nenhuma aposta em aberto."
                    : "Nenhuma aposta encerrada ainda."
                }
              />
            ) : (
              page.slips.map((slip) => (
                <SlipCard
                  key={slip.id}
                  slip={slip}
                  now={now}
                  timeZone={timeZone}
                  closed={filter === "encerradas"}
                />
              ))
            )}

            {(page.nextCursor || cursor) && (
              <div className="flex flex-col gap-3 pt-2">
                {page.nextCursor && (
                  <Link href={slipFilterHref(filter, page.nextCursor)} className={PAGER_LINK}>
                    apostas mais antigas →
                  </Link>
                )}
                {cursor && (
                  <Link href={slipFilterHref(filter)} className={PAGER_LINK}>
                    ← voltar ao topo
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        <p className="mt-10 text-meta leading-relaxed text-muted-foreground tracking-tight">
          {RISK_DISCLAIMER_PT_BR}
        </p>
      </PageContainer>
    </div>
  );
}
