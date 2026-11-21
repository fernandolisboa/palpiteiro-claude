import { and, count, desc, eq, gte, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { aiCalls, matches } from "@/db/schema";
import type { AiCallStatus } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";

/**
 * Falhas de IA legíveis pro admin (#669): as rows de `ai_calls` com status ≠ ok, sem
 * precisar de SQL no banco de produção. Nunca seleciona `input_payload` nem
 * `output_payload` (system prompt, contexto e texto do modelo): só colunas escalares e
 * o `retryOf` do output (a 2ª tentativa do narrador aponta pra 1ª), e se uma 2ª
 * tentativa ok refez a row (`recoveredByRetry`).
 *
 * `costUsd` é numeric (string no Drizzle): vira number aqui, na fronteira.
 */

/** A tela mostra as N falhas mais recentes da janela (sem paginação). */
export const AI_CALL_FAILURES_LIMIT = 100;

/**
 * Prompts cujo `error_message` pode ecoar texto livre do usuário (o bilhete colado, o
 * contexto extra, a explicação do bilhete): o texto é anulado NO SQL, antes de sair do
 * banco (LGPD, ADR 0046). Um prompt novo de texto livre entra aqui.
 */
export const FREE_TEXT_PROMPT_PREFIXES = [
  "bet_parse",
  "user_palpite",
  "bet_slip_explain",
] as const;

export type AiCallFailureRow = {
  id: string;
  createdAt: Date;
  matchId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  status: AiCallStatus;
  // null quando não há mensagem ou quando foi omitida (errorRedacted).
  errorMessage: string | null;
  errorRedacted: boolean;
  // A 2ª tentativa do narrador (#669) aponta pra row da 1ª.
  retryOf: string | null;
  // Uma 2ª tentativa com status ok aponta pra esta row: a análise saiu com o texto da IA.
  recoveredByRetry: boolean;
  latencyMs: number;
  costUsd: number;
};

export type AiCallFailureSummaryRow = {
  promptVersion: string;
  // Todas as chamadas da versão na janela (ok incluído), pra dar a taxa.
  total: number;
  failed: number;
  byStatus: Partial<Record<AiCallStatus, number>>;
};

type FailureFilter = { days: number; matchId: string | null; now?: Date };

function windowStart(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function scope(f: FailureFilter): SQL | undefined {
  const since = windowStart(f.days, f.now ?? new Date());
  return and(
    gte(aiCalls.createdAt, since),
    f.matchId === null ? undefined : eq(aiCalls.matchId, f.matchId)
  );
}

const freeTextPrompt = sql.join(
  FREE_TEXT_PROMPT_PREFIXES.map(
    (prefix) => sql`starts_with(${aiCalls.promptVersion}, ${prefix})`
  ),
  sql` or `
);

// A 2ª tentativa roda logo depois da 1ª, na mesma função: a janela de 1 h limita a
// subconsulta ao trecho do índice de created_at, sem varrer a tabela por row.
const retryCall = alias(aiCalls, "retry_call");
const recoveredByRetry = sql<boolean>`exists (
  select 1 from ${aiCalls} as ${sql.identifier("retry_call")}
  where ${retryCall.status} = 'ok'
    and ${retryCall.createdAt} >= ${aiCalls.createdAt}
    and ${retryCall.createdAt} < ${aiCalls.createdAt} + interval '1 hour'
    and ${retryCall.outputPayload}->>'retryOf' = ${aiCalls.id}::text
)`;

export async function getAiCallFailures(
  f: FailureFilter
): Promise<{ rows: AiCallFailureRow[]; hasMore: boolean }> {
  const raw = await db
    .select({
      id: aiCalls.id,
      createdAt: aiCalls.createdAt,
      matchId: aiCalls.matchId,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      provider: aiCalls.provider,
      model: aiCalls.model,
      promptVersion: aiCalls.promptVersion,
      status: aiCalls.status,
      errorMessage: sql<
        string | null
      >`case when (${freeTextPrompt}) then null else ${aiCalls.errorMessage} end`,
      errorRedacted: sql<boolean>`((${freeTextPrompt}) and ${aiCalls.errorMessage} is not null)`,
      retryOf: sql<string | null>`${aiCalls.outputPayload}->>'retryOf'`,
      recoveredByRetry,
      latencyMs: aiCalls.latencyMs,
      costUsd: aiCalls.costUsd,
    })
    .from(aiCalls)
    .leftJoin(matches, eq(aiCalls.matchId, matches.id))
    .where(and(ne(aiCalls.status, "ok"), scope(f)))
    .orderBy(desc(aiCalls.createdAt), desc(aiCalls.id))
    .limit(AI_CALL_FAILURES_LIMIT + 1);

  return {
    rows: raw.slice(0, AI_CALL_FAILURES_LIMIT).map((r) => ({
      ...r,
      errorRedacted: r.errorRedacted === true,
      recoveredByRetry: r.recoveredByRetry === true,
      costUsd: Number(r.costUsd ?? 0),
    })),
    hasMore: raw.length > AI_CALL_FAILURES_LIMIT,
  };
}

/**
 * Taxa de falha por versão de prompt na janela: conta todas as chamadas (ok incluído)
 * e devolve só as versões com alguma falha, as de mais falhas primeiro. Conta
 * CHAMADAS, não análises: uma narração reprovada e refeita com sucesso conta 1 falha
 * em 2 chamadas (a página avisa).
 */
export async function getAiCallFailureSummary(
  f: FailureFilter
): Promise<AiCallFailureSummaryRow[]> {
  const raw = await db
    .select({
      promptVersion: aiCalls.promptVersion,
      status: aiCalls.status,
      calls: count(),
    })
    .from(aiCalls)
    .where(scope(f))
    .groupBy(aiCalls.promptVersion, aiCalls.status);

  const byVersion = new Map<string, AiCallFailureSummaryRow>();
  for (const r of raw) {
    const entry = byVersion.get(r.promptVersion) ?? {
      promptVersion: r.promptVersion,
      total: 0,
      failed: 0,
      byStatus: {},
    };
    entry.total += r.calls;
    if (r.status !== "ok") {
      entry.failed += r.calls;
      entry.byStatus[r.status] = (entry.byStatus[r.status] ?? 0) + r.calls;
    }
    byVersion.set(r.promptVersion, entry);
  }
  return [...byVersion.values()]
    .filter((e) => e.failed > 0)
    .sort(
      (a, b) =>
        b.failed - a.failed || a.promptVersion.localeCompare(b.promptVersion)
    );
}
