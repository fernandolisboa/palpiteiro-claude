import { Redis } from "@upstash/redis";
import { Resend } from "resend";

import { getCostSummary } from "@/lib/db/queries/ai-costs";
import { formatCostUsdTotal } from "@/lib/format";

/**
 * Alerta diário por e-mail quando o gasto agregado de IA do dia-corrente (UTC)
 * passa de um teto configurável. É a ÚNICA porta de entrada do envio de alerta
 * (mantém o `resend.emails.send` isolado em lib/notifications, conforme
 * fronteiras do CLAUDE.md).
 *
 * Ordem dos checks (de menos pra mais trabalho) pra nunca tocar KV/Resend no
 * caminho comum (sob o teto): threshold → spend → recipient → dedup → send.
 */

export type SpendAlertResult =
  | { skipped: "no_threshold" }
  | { skipped: "under_threshold"; spendUsd: number; thresholdUsd: number }
  | { skipped: "no_recipient" }
  | { skipped: "already_sent"; spendUsd: number; thresholdUsd: number }
  | { sent: true; spendUsd: number; thresholdUsd: number };

// Guard de warn-once pro KV ausente (espelha lib/rate-limit.ts).
let warnedNoKv = false;

/** `YYYY-MM-DD` em UTC. toISOString é sempre UTC, casando com a janela de dia
 * UTC que getCostSummary().todayUsd mede. */
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runSpendAlert(
  now: Date = new Date(),
): Promise<SpendAlertResult> {
  // 1) THRESHOLD — opt-in: unset/NaN/<=0 desliga o alerta (nada de DB/KV/Resend).
  const thresholdUsd = Number(process.env.DAILY_AI_SPEND_ALERT_USD);
  if (!Number.isFinite(thresholdUsd) || thresholdUsd <= 0) {
    return { skipped: "no_threshold" };
  }

  // 2) SPEND — fonte única é getCostSummary (já faz numeric string→Number na
  // fronteira da query). Sob o teto: nenhum envio, nenhum KV.
  const { todayUsd: spendUsd } = await getCostSummary(now);
  if (spendUsd <= thresholdUsd) {
    return { skipped: "under_threshold", spendUsd, thresholdUsd };
  }

  // 3) RECIPIENT — sem destinatário, o cron roda mas não envia nada.
  const to = process.env.SPEND_ALERT_EMAIL;
  if (!to) {
    console.warn(JSON.stringify({ scope: "spend_alert", event: "no_recipient" }));
    return { skipped: "no_recipient" };
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.error(
      JSON.stringify({ scope: "spend_alert", event: "no_from_address" }),
    );
    return { skipped: "no_recipient" };
  }

  // 4) IDEMPOTÊNCIA (por dia UTC) — construção EXPLÍCITA do Redis (NÃO
  // Redis.fromEnv(): o Vercel KV expõe KV_REST_API_* e fromEnv espera UPSTASH_*).
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const redis = url && token ? new Redis({ url, token }) : null;
  if (!redis && !warnedNoKv) {
    // Fail-open: sem KV (dev local) seguimos sem dedup por-dia. O cron só roda
    // em prod, onde o KV existe — nunca bloquear o alerta por falta de KV de dev.
    console.warn(
      "[spend-alert] KV_REST_API_URL/KV_REST_API_TOKEN unset — proceeding without per-day dedup (fail-open, dev only).",
    );
    warnedNoKv = true;
  }
  const key = `spend-alert:sent:${utcDateKey(now)}`;
  if (redis && (await redis.get(key))) {
    return { skipped: "already_sent", spendUsd, thresholdUsd };
  }

  // 5) SEND — GET-then-SET-after-success: se o envio lançar, o dia NÃO é marcado
  // como enviado (a exceção propaga), preservando a retentativa.
  const dateLabel = utcDateKey(now);
  const subject = `[Palpiteiro] AI spend ${formatCostUsdTotal(spendUsd)} exceeded ${formatCostUsdTotal(thresholdUsd)} on ${dateLabel} (UTC)`;
  const text = `Aggregate AI spend for ${dateLabel} (UTC) reached ${formatCostUsdTotal(spendUsd)}, above the configured threshold of ${formatCostUsdTotal(thresholdUsd)}.\n\nThis is a daily budget alert from Palpiteiro. Review usage in the costs dashboard.`;

  const resend = new Resend(process.env.AUTH_RESEND_KEY);
  await resend.emails.send({ from, to, subject, text });

  // 6) MARK SENT só DEPOIS do envio bem-sucedido (TTL 48h).
  if (redis) {
    await redis.set(key, "1", { ex: 60 * 60 * 48 });
  }

  return { sent: true, spendUsd, thresholdUsd };
}
