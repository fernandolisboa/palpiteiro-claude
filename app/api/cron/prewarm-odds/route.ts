import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { prewarmOdds } from "@/lib/odds/prewarm-odds";

// Vercel Cron hits this endpoint (GET) a cada 6h. Pré-aquece (fetch+snapshot) as odds
// dos mercados AO VIVO (over/under 2.5 + 1X2) das ligas ativas com jogo próximo, pra
// que o load da match page ache snapshot fresca e NÃO dispare o fetch ao vivo (#371).
// No-op barato quando nenhuma liga ativa tem jogo na janela. O monitor Sentry vem do
// `automaticVercelMonitors` (next.config.ts) — registrar o cron em vercel.json basta,
// como nos demais crons (zero código de Sentry por cron).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pode disparar fetch(s) da The Odds API (1 crédito/liga por mercado featured).
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  // Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`. Fail-closed: sem secret
  // configurado (ou header divergente), rejeita como qualquer caller não-autorizado
  // (401, body genérico) — não vaza config nem devolve 5xx que o scheduler re-tentaria.
  if (!isAuthorizedCron(request, "prewarm_odds")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await prewarmOdds();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "prewarm_odds",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "prewarm_odds_failed" },
      { status: 500 },
    );
  }
}
