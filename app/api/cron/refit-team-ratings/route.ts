import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { refitTeamRatings } from "@/lib/ratings/refit-team-ratings";

// Vercel Cron hits this endpoint (GET) uma vez por dia. Refita o Dixon-Coles de cada
// liga ativa (ADR 0051) com os últimos 3 anos de resultados e troca os ratings que o
// predict lê. Liga que falha mantém o fit anterior (o summary diz qual). Monitor do
// Sentry via `automaticVercelMonitors`, como os demais crons.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 3 chamadas de provider por liga (cache de 1h) + um fit de milissegundos por liga.
export const maxDuration = 120;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "refit_team_ratings")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await refitTeamRatings();
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "refit_team_ratings",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json(
      { ok: false, error: "refit_team_ratings_failed" },
      { status: 500 }
    );
  }
}
