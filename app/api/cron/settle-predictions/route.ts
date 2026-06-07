import { NextResponse } from "next/server";

import { settlePendingPredictions } from "@/lib/settlement/settle";

// Vercel Cron hits this endpoint (GET) once a day. It's the only API route in
// the app — settlement needs an HTTP trigger that the platform scheduler can
// call, which Server Actions can't provide.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: refuse to run unauthenticated if the secret isn't set.
    console.error(
      JSON.stringify({ scope: "settlement", event: "missing_cron_secret" }),
    );
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await settlePendingPredictions();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "settlement",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "settlement_failed" },
      { status: 500 },
    );
  }
}
