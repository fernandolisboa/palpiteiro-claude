import { notFound } from "next/navigation";

import { AdminSubTabs } from "@/components/admin/admin-sub-tabs";
import { PageHeading } from "@/components/admin/page-heading";
import { IntentLink } from "@/components/intent-link";
import { RevisitRefresh } from "@/components/revisit-refresh";
import {
  AI_CALL_FAILURE_WINDOWS,
  AI_CALL_FAILURES_PATH,
  AI_CALL_STATUS_LABEL,
  errorPreview,
  failuresHref,
  parseAiCallFailuresParams,
  type AiCallFailureWindow,
  type AiCallFailuresParams,
} from "@/lib/admin/ai-call-failures-params";
import { getSession } from "@/lib/auth/session";
import {
  AI_CALL_FAILURES_LIMIT,
  getAiCallFailures,
  getAiCallFailureSummary,
  type AiCallFailureRow,
  type AiCallFailureSummaryRow,
} from "@/lib/db/queries/ai-call-failures";
import {
  formatCostUsd,
  formatKickoffDateTime,
  formatModelName,
} from "@/lib/format";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ dias?: string | string[]; jogo?: string | string[] }>;
};

const WINDOW_LABEL: Record<AiCallFailureWindow, string> = {
  1: "24 h",
  7: "7 dias",
  30: "30 dias",
};

// Assistente de IA · falhas (#669): as chamadas de IA que falharam, com o motivo
// (ai_calls.error_message), sem SQL no banco. Gateado por app/(app)/admin/layout.tsx.
// Nunca mostra payloads; o erro de prompts de texto livre do usuário vem omitido do
// banco (ADR 0046, ver a query).
export default async function AdminAiFailuresPage({ searchParams }: PageProps) {
  // Role checado na própria página, não só no layout: o App Router pode renderizar o
  // segmento da página sem re-rodar o layout (auditoria de segurança 2026-11-01).
  if ((await getSession())?.user?.role !== "admin") notFound();
  const params = parseAiCallFailuresParams(await searchParams);
  const now = new Date();
  const filter = { days: params.days, matchId: params.matchId, now };
  const [{ rows, hasMore }, summary, timeZone] = await Promise.all([
    getAiCallFailures(filter),
    getAiCallFailureSummary(filter),
    getRequestTimeZone(),
  ]);
  const filteredMatch = params.matchId
    ? (rows.find((r) => r.homeTeam !== null) ?? null)
    : null;

  return (
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <div className="max-w-reading mx-auto w-full px-6 py-8">
        <PageHeading
          title="Assistente de IA"
          subtitle="falhas · chamadas de IA que não deram certo, com o motivo"
        />
        <AdminSubTabs section="/admin/ia" current={AI_CALL_FAILURES_PATH} />

        <div className="flex flex-wrap items-center gap-3 pb-8">
          <nav
            aria-label="Janela"
            className="border-border inline-flex gap-0.5 rounded-md border p-0.5"
          >
            {AI_CALL_FAILURE_WINDOWS.map((days) => (
              <IntentLink
                key={days}
                href={failuresHref({ ...params, days })}
                aria-current={days === params.days ? "page" : undefined}
                className={cn(
                  "text-body-sm text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm px-3 py-1.5 tracking-tight transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                  days === params.days && "bg-surface-2 text-foreground"
                )}
              >
                {WINDOW_LABEL[days]}
              </IntentLink>
            ))}
          </nav>
          {params.matchId && (
            <span className="border-border text-body-sm inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="truncate">
                jogo:{" "}
                {filteredMatch
                  ? `${filteredMatch.homeTeam} x ${filteredMatch.awayTeam}`
                  : params.matchId.slice(0, 8)}
              </span>
              <IntentLink
                href={failuresHref({ ...params, matchId: null })}
                className="text-muted-foreground hover:text-foreground shrink-0 underline-offset-4 hover:underline"
              >
                limpar filtro
              </IntentLink>
            </span>
          )}
        </div>

        <section className="pb-8">
          <h2 className="text-meta tracking-label text-muted-foreground pb-3 font-mono uppercase">
            por versão de prompt
          </h2>
          {summary.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nenhuma falha nesta janela.
            </p>
          ) : (
            <div className="border-border rounded-md border">
              {summary.map((s) => (
                <SummaryRow key={s.promptVersion} row={s} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-meta tracking-label text-muted-foreground pb-3 font-mono uppercase">
            falhas
          </h2>
          {rows.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nenhuma falha nesta janela.
            </p>
          ) : (
            <>
              <ul className="border-border rounded-md border">
                {rows.map((r) => (
                  <FailureItem
                    key={r.id}
                    row={r}
                    params={params}
                    when={formatKickoffDateTime(r.createdAt, now, timeZone)}
                  />
                ))}
              </ul>
              {hasMore && (
                <p className="text-body-sm text-muted-foreground pt-3">
                  Mostrando as {AI_CALL_FAILURES_LIMIT} mais recentes desta
                  janela.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryRow({ row }: { row: AiCallFailureSummaryRow }) {
  const rate = (row.failed / row.total) * 100;
  return (
    <div className="border-border-subtle flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body-sm min-w-0 truncate font-mono">
          {row.promptVersion}
        </span>
        <span className="text-body-sm shrink-0 font-mono tabular-nums">
          {row.failed} de {row.total} ·{" "}
          {rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
        </span>
      </div>
      <span className="text-meta text-muted-foreground">
        {Object.entries(row.byStatus)
          .map(
            ([status, n]) =>
              `${AI_CALL_STATUS_LABEL[status as keyof typeof AI_CALL_STATUS_LABEL] ?? status} ${n}`
          )
          .join(" · ")}
      </span>
    </div>
  );
}

function FailureItem({
  row,
  params,
  when,
}: {
  row: AiCallFailureRow;
  params: AiCallFailuresParams;
  when: string;
}) {
  return (
    <li className="border-border-subtle flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-body-sm font-mono tabular-nums">{when}</span>
        <span className="flex items-baseline gap-2">
          {row.retryOf && (
            <span className="bg-surface-2 text-meta rounded-sm px-1.5 py-0.5">
              2ª tentativa
            </span>
          )}
          <span title={row.status} className="text-body-sm font-medium">
            {AI_CALL_STATUS_LABEL[row.status]}
          </span>
        </span>
      </div>
      {row.matchId && (
        <div className="text-body-sm flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <IntentLink
            href={`/match/${row.matchId}`}
            className="min-w-0 underline-offset-4 hover:underline"
          >
            {row.homeTeam && row.awayTeam
              ? `${row.homeTeam} x ${row.awayTeam}`
              : "jogo"}
          </IntentLink>
          {params.matchId !== row.matchId && (
            <IntentLink
              href={failuresHref({ ...params, matchId: row.matchId })}
              className="text-meta text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              só este jogo
            </IntentLink>
          )}
        </div>
      )}
      <div className="text-meta text-muted-foreground flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono">
        <span className="break-all">{row.promptVersion}</span>
        <span title={row.model}>{formatModelName(row.model)}</span>
        <span className="tabular-nums">{row.latencyMs}ms</span>
        <span className="tabular-nums">{formatCostUsd(row.costUsd)}</span>
      </div>
      <ErrorText row={row} />
    </li>
  );
}

function ErrorText({ row }: { row: AiCallFailureRow }) {
  if (row.errorRedacted) {
    return (
      <p className="text-body-sm text-muted-foreground italic">
        texto omitido (pode conter texto do usuário)
      </p>
    );
  }
  if (!row.errorMessage) {
    return (
      <p className="text-body-sm text-muted-foreground">sem mensagem de erro</p>
    );
  }
  const preview = errorPreview(row.errorMessage);
  if (preview === row.errorMessage) {
    return (
      <p className="text-body-sm font-mono [overflow-wrap:anywhere]">
        {row.errorMessage}
      </p>
    );
  }
  return (
    <details className="group">
      <summary className="text-body-sm cursor-pointer font-mono [overflow-wrap:anywhere]">
        {preview}
      </summary>
      <pre className="bg-surface-2 text-meta mt-2 max-h-80 overflow-auto rounded-sm p-3 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
        {row.errorMessage}
      </pre>
    </details>
  );
}
