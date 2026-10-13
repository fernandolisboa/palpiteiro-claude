import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { computeMatchModels } from "@/lib/model-base/compute-match-models";

// Vercel Cron hits this endpoint (GET) às 01:30/07:30/13:30/19:30 UTC (#555, ADR 0052):
// recalcula a base do modelo de cada jogo das ligas ativas nos próximos 7 dias (λ do
// Dixon-Coles refitado às 07:00, JEV a ≤48h), sem Claude e sem The Odds API. Erro em
// jogo ou liga responde 500 com o resumo, pro monitor do Sentry
// (`automaticVercelMonitors`). JEV que falhou, prazo do run e chave TypeSafe ausente
// não são erro (fail-open, esperado sob carga); run sobreposto sai com `skipped`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O throttle da API-Football (8/min) consome ~55 s por jogo com JEV: rota própria com
// o orçamento inteiro do plano, em vez de pendurar no refit ou no sync de fixtures.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "compute_match_models")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await computeMatchModels();
    const ok = summary.errors === 0;
    return NextResponse.json({ ok, summary }, { status: ok ? 200 : 500 });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "compute_match_models",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "compute_match_models_failed" },
      { status: 500 },
    );
  }
}
