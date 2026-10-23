import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { runLineupRechecks } from "@/lib/lineup-recheck/run";

// Vercel Cron hits this endpoint (GET) a cada 10 min, nos minutos 5/15/…/55 (#619, PR B):
// reconfere com a escalação confirmada as análises code_jev de pré-jogo feitas antes
// dela, nos jogos com KO em até 75 min. Só em código: sem LLM, sem The Odds API e sem o
// limite diário. Nada a fazer (sem candidato, flag OFF, lock, cron da base rodando,
// escalação que não saiu, JEV que falhou) responde 200; erro inesperado num jogo ou numa
// reconferência responde 500 com o resumo, pro monitor do Sentry.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A passada completa de um jogo espera atrás do limite de 8 req/min da API-Football.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "recheck_lineups")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runLineupRechecks();
    const ok = summary.errors === 0;
    return NextResponse.json({ ok, summary }, { status: ok ? 200 : 500 });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "recheck_lineups",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "recheck_lineups_failed" },
      { status: 500 },
    );
  }
}
