import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import {
  isRefitFailure,
  refitTeamRatings,
} from "@/lib/ratings/refit-team-ratings";

// Vercel Cron hits this endpoint (GET) uma vez por dia. Refita o Dixon-Coles de cada
// liga ativa (ADR 0051) com os últimos 3 anos de resultados e troca os ratings que o
// predict lê. Liga que falha mantém o fit anterior; qualquer falha (não "poucos
// jogos") responde 500 com o resultado por liga, pro monitor do Sentry
// (`automaticVercelMonitors`) acusar antes de o fit envelhecer e cair no heurístico.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// No dia a dia, 1 chamada de provider por liga. A 1ª rodada de uma liga busca 4
// temporadas, e o throttle da API-Football (8/min) enfileira: teto do plano.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "refit_team_ratings")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await refitTeamRatings();
    const ok = !results.some(isRefitFailure);
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
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
