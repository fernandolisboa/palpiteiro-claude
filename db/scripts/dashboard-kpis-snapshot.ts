import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import {
  computeBankrollSeries,
  computeDashboardKpis,
  keepLatestPerMatch,
} from "../../lib/dashboard/kpis";
import { getUserDashboardRows } from "../../lib/db/queries/dashboard";
import { predictions } from "../schema";

/**
 * Snapshot READ-ONLY dos KPIs do dashboard por usuário — a régua de PARIDADE do
 * #162. Reusa o pipeline de DADOS da app (getUserDashboardRows → keepLatestPerMatch
 * → computeDashboardKpis/computeBankrollSeries, igual deriveDashboardView, antes da
 * camada de formatação toDashboardKpiView). Os KPIs crus implicam paridade da view
 * (a view é função pura determinística deles) e ainda capturam mais (valores não
 * arredondados). A série completa do bankroll é emitida pra o diff constranger o
 * gráfico inteiro, não só o endpoint.
 *
 * Prova de paridade: rode ANTES de uma mudança de pipeline, rode DEPOIS e compare a
 * saída JSON — DEVE ser idêntica. Usado nas migrações expand→contract do pivot
 * multi-mercado (a #179 dropou o legado over/under sem mexer em nenhum número que o
 * dashboard lê). Não escreve nada.
 *
 *   pnpm tsx db/scripts/dashboard-kpis-snapshot.ts > before.json
 *   # aplique a mudança (slice de código / migration de contract)
 *   pnpm tsx db/scripts/dashboard-kpis-snapshot.ts > after.json
 *   diff before.json after.json   # vazio = paridade provada
 */

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — create .env.local from .env.example");
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { casing: "snake_case" });

  const users = await db
    .selectDistinct({ userId: predictions.userId })
    .from(predictions);

  const report = [];
  for (const { userId } of users.sort((a, b) => a.userId.localeCompare(b.userId))) {
    const rows = await getUserDashboardRows(userId);
    const deduped = keepLatestPerMatch(rows);
    const kpis = computeDashboardKpis(deduped);
    const series = computeBankrollSeries(deduped);
    report.push({
      userId,
      rowsTotal: rows.length,
      rowsDeduped: deduped.length,
      kpis,
      bankroll: series.map((p) => ({ t: p.t, cumulative: p.cumulative })),
    });
  }

  // Saída determinística (ordenada) pra um diff before/after limpo.
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("kpis snapshot failed:", err);
  process.exit(1);
});
