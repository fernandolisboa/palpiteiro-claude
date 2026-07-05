import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { settlePendingPredictions } from "@/lib/settlement/settle";
import { settlePendingPalpites } from "@/lib/settlement/settle-palpites";
import { settleUserBetLegs } from "@/lib/settlement/settle-user-bets";

// Vercel Cron hits this endpoint (GET) once a day. It's the only API route in
// the app — settlement needs an HTTP trigger that the platform scheduler can
// call, which Server Actions can't provide.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically. Fail
  // closed: if the secret isn't configured or the header mismatches, reject like
  // any other unauthorized caller (401, generic body) — don't leak config state
  // or return a 5xx that the scheduler would retry. The real reason is logged.
  if (!isAuthorizedCron(request, "settlement")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await settlePendingPredictions();
    // Liquidação de palpites (ADR 0028), sequencial DENTRO do mesmo try.
    // ALL-OR-NOTHING: um throw em qualquer dos dois aborta o request (500), o
    // Vercel re-tenta — seguro porque AMBOS são idempotentes (onConflictDoNothing
    // no UNIQUE). Sequencial (não paralelo) pra não duplicar pressão no provider.
    const palpiteSummary = await settlePendingPalpites();
    // Liquidação das apostas livres (ADR 0036), sequencial no MESMO try — idempotente
    // (onConflictDoNothing no UNIQUE legId), então o re-try do Vercel é seguro.
    const userBetSummary = await settleUserBetLegs();
    return NextResponse.json({
      ok: true,
      summary,
      palpiteSummary,
      userBetSummary,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "settlement",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json(
      { ok: false, error: "settlement_failed" },
      { status: 500 }
    );
  }
}
