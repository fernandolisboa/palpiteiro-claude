import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/auth/cron-auth";
import { runModelVersionCheck } from "@/lib/ai/model-versions/check";

// Vercel Cron hits this endpoint (GET) uma vez por dia (ADR 0062). Lista os modelos da
// API Anthropic, sonda a versão nova de Haiku, Sonnet ou Opus e a adota se passar;
// rebaixa a adotada que regrediu e avisa por e-mail. Listagem fora do ar ou erro numa
// família responde 500, pro monitor do Sentry (`automaticVercelMonitors`) acusar. Pra
// rodar à mão: `curl -H "Authorization: Bearer $CRON_SECRET" …/api/cron/check-model-versions`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A checagem corta em 240s (CHECK_BUDGET_MS); a sondagem são poucas chamadas curtas.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request, "check_model_versions")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runModelVersionCheck();
    const ok =
      result.status === "skipped" ||
      (result.status !== "listing_failed" && !result.summary.error);
    return NextResponse.json({ ok, result }, { status: ok ? 200 : 500 });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "check_model_versions",
        event: "cron_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json(
      { ok: false, error: "check_model_versions_failed" },
      { status: 500 }
    );
  }
}
