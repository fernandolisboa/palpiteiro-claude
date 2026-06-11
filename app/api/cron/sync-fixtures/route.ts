import { NextResponse } from "next/server";

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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      JSON.stringify({ scope: "sync_fixtures", event: "missing_cron_secret" }),
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureUpcomingFixturesSynced({ force: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "sync_fixtures",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "sync_fixtures_failed" },
      { status: 500 },
    );
  }
}
