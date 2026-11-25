import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { rebuildAnalyzedKickoffs } from "@/lib/sync/analyzed-kickoffs";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";

// Vercel Cron hits this endpoint (GET) every 6h (see vercel.json) and sends
// `Authorization: Bearer <CRON_SECRET>` automatically. The route fails closed
// (401 when the secret is unset or mismatched), mirroring spend-alert.
//
// `force: true` bypasses the durable KV lock and re-runs the provider fetch,
// refreshing the lock's TTL so the home's `after()` trigger stays a no-op
// between runs. maxDuration=60 because the season fetch can take ~45s — only
// this cron route eats that latency; user routes never await the sync.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "sync_fixtures")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureUpcomingFixturesSynced({ force: true });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "sync_fixtures",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    await refreshAnalyzedKickoffs();
    return NextResponse.json(
      { ok: false, error: "sync_fixtures_failed" },
      { status: 500 },
    );
  }
  await refreshAnalyzedKickoffs();
  return NextResponse.json({ ok: true });
}

// Índice do portão dos crons frequentes (#680, ADR 0074): reconstruído aqui a cada 6 h,
// com ou sem sucesso do sync (o banco já está acordado e o índice não depende do
// provider). Falha só loga: sem carimbo novo, o portão reabre sozinho pelo TTL.
async function refreshAnalyzedKickoffs(): Promise<void> {
  try {
    const indexed = await rebuildAnalyzedKickoffs();
    console.log(
      JSON.stringify({ scope: "sync_fixtures", event: "analyzed_kickoffs_rebuilt", indexed }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "sync_fixtures",
        event: "analyzed_kickoffs_rebuild_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
