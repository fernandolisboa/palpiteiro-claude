import { count, desc, eq, gte, sql, sum } from "drizzle-orm";

import { aiCalls, users } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Agregação reusável de gasto de IA a partir de `ai_calls`, pro admin de custos
 * (#13). Todas as funções somam TODAS as rows — chamadas que falharam mas foram
 * cobradas (status tool_missing/invalid_output/provider_error/timeout/
 * rate_limited) custam dinheiro real, então NÃO há filtro de status.
 *
 * Numeric-as-string (gotcha do CLAUDE.md + memory drizzle-numeric-returns-string):
 * `costUsd` é numeric(10,6) → o Drizzle devolve string; `SUM(cost_usd)` também
 * volta string (ou NULL quando zero rows). A conversão pra number acontece AQUI,
 * na fronteira da query (`Number(x ?? 0)`), pra que a página nunca faça string
 * math. Counts (`count()`) já voltam number e passam direto.
 *
 * Tempo: `createdAt` é timestamptz. Os limites de "hoje"/"últimos 7d" e o
 * agrupamento por dia são ancorados em UTC (Date.UTC pros limites em JS;
 * `(created_at at time zone 'UTC')::date` pro agrupamento) pra não bucketizar
 * dias errado num servidor em timezone não-UTC.
 */

export type CostSummary = {
  totalUsd: number;
  todayUsd: number;
  last7dUsd: number;
  totalCalls: number;
};

export type CostByDay = { day: string; totalUsd: number; calls: number };

export type CostByUser = {
  userId: string;
  email: string;
  totalUsd: number;
  calls: number;
};

export type CostByModel = { model: string; totalUsd: number; calls: number };

/** Início do dia-calendário UTC que contém `d`. */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * KPIs do header: gasto total, de hoje, dos últimos 7 dias e total de chamadas,
 * em UM único round-trip. "Hoje" = createdAt >= início do dia UTC corrente.
 * "Últimos 7d" = a janela de 7 dias-calendário incluindo hoje, ou seja desde o
 * início do dia UTC 6 dias atrás (hoje + 6 dias anteriores = 7 dias).
 *
 * Os totais de hoje/7d usam SUM condicional (case-when) pra ainda caberem numa
 * só query, em vez de três SELECTs separados.
 */
export async function getCostSummary(
  now: Date = new Date(),
): Promise<CostSummary> {
  const startOfTodayUtc = startOfUtcDay(now);
  const start7dUtc = new Date(startOfTodayUtc);
  start7dUtc.setUTCDate(start7dUtc.getUTCDate() - 6);

  const [row] = await db
    .select({
      totalUsd: sum(aiCalls.costUsd),
      totalCalls: count(),
      todayUsd: sum(
        sql`case when ${aiCalls.createdAt} >= ${startOfTodayUtc} then ${aiCalls.costUsd} else 0 end`,
      ),
      last7dUsd: sum(
        sql`case when ${aiCalls.createdAt} >= ${start7dUtc} then ${aiCalls.costUsd} else 0 end`,
      ),
    })
    .from(aiCalls);

  return {
    totalUsd: Number(row?.totalUsd ?? 0),
    todayUsd: Number(row?.todayUsd ?? 0),
    last7dUsd: Number(row?.last7dUsd ?? 0),
    totalCalls: row?.totalCalls ?? 0,
  };
}

/**
 * Gasto por dia-calendário UTC nos últimos `days` dias, mais recente primeiro.
 * O cast `::date` no driver neon-http volta como string `YYYY-MM-DD`, então a
 * página renderiza sem ambiguidade de timezone de Date.
 */
export async function getCostByDay(
  days = 30,
  now: Date = new Date(),
): Promise<CostByDay[]> {
  const dayExpr = sql<string>`(${aiCalls.createdAt} at time zone 'UTC')::date`.as(
    "day",
  );

  // `now` injetável (default = agora) pra travar o offset -(days-1) em teste.
  const cutoffUtc = startOfUtcDay(now);
  cutoffUtc.setUTCDate(cutoffUtc.getUTCDate() - (days - 1));

  const rows = await db
    .select({
      day: dayExpr,
      totalUsd: sum(aiCalls.costUsd),
      calls: count(),
    })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, cutoffUtc))
    .groupBy(dayExpr)
    .orderBy(desc(dayExpr));

  return rows.map((r) => ({
    day: r.day,
    totalUsd: Number(r.totalUsd ?? 0),
    calls: r.calls,
  }));
}

/**
 * Gasto por usuário (com e-mail), maiores gastos primeiro. innerJoin é seguro:
 * `aiCalls.userId` é notNull com onDelete restrict (db/schema.ts), então toda
 * row de ai_call tem um usuário correspondente.
 */
export async function getCostByUser(): Promise<CostByUser[]> {
  const rows = await db
    .select({
      userId: aiCalls.userId,
      email: users.email,
      totalUsd: sum(aiCalls.costUsd),
      calls: count(),
    })
    .from(aiCalls)
    .innerJoin(users, eq(aiCalls.userId, users.id))
    .groupBy(aiCalls.userId, users.email)
    .orderBy(desc(sum(aiCalls.costUsd)));

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    totalUsd: Number(r.totalUsd ?? 0),
    calls: r.calls,
  }));
}

/** Gasto por modelo (texto), maiores gastos primeiro. */
export async function getCostByModel(): Promise<CostByModel[]> {
  const rows = await db
    .select({
      model: aiCalls.model,
      totalUsd: sum(aiCalls.costUsd),
      calls: count(),
    })
    .from(aiCalls)
    .groupBy(aiCalls.model)
    .orderBy(desc(sum(aiCalls.costUsd)));

  return rows.map((r) => ({
    model: r.model,
    totalUsd: Number(r.totalUsd ?? 0),
    calls: r.calls,
  }));
}
