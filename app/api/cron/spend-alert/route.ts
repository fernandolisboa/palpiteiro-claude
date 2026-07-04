import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { runSpendAlert } from "@/lib/notifications/spend-alert";

// Vercel Cron hits this endpoint (GET) once a day (23:00 UTC) and sends
// `Authorization: Bearer <CRON_SECRET>` automatically. The route fails closed
// (401 when the secret is unset or mismatched), mirroring settle-predictions.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "spend_alert")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runSpendAlert();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "spend_alert",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "spend_alert_failed" },
      { status: 500 },
    );
  }
}
