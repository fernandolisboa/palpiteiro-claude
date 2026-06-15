import { NextResponse } from "next/server";

import { captureClosingLines } from "@/lib/odds/closing-line";

// Vercel Cron hits this endpoint (GET) a cada 30min. Captura a closing line (snapshot
// pré-kickoff) dos jogos com KO em ≤90min que têm predição non-pass, alimentando o
// CLV (#180). No-op barato quando a flag `enableClvCapture` está OFF (default).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pode disparar fetch(s) da The Odds API (1 crédito/liga featured; 1/evento additional).
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`. Fail-closed: sem secret
  // configurado, rejeita como qualquer caller não-autorizado (401, body genérico) —
  // não vaza estado de config nem devolve 5xx que o scheduler re-tentaria.
  if (!secret) {
    console.error(
      JSON.stringify({
        scope: "capture_closing_odds",
        event: "missing_cron_secret",
      }),
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await captureClosingLines();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "capture_closing_odds",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "capture_closing_odds_failed" },
      { status: 500 },
    );
  }
}
