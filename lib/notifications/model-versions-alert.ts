import { Resend } from "resend";

// E-mail do cron check-model-versions (ADR 0062, S1): versão adotada (com o preço
// estimado, pedindo confirmação), versão reprovada ou rebaixada, e conferida que sumiu
// da listagem da API. Mesmo destinatário e remetente do alerta de gasto
// (lib/notifications/spend-alert.ts). O envio fica isolado aqui, em lib/notifications.

export type ModelVersionsAlertEvents = {
  adopted: { id: string; pinnedId: string; inputPricePerMTok: number; outputPricePerMTok: number }[];
  failed: { id: string; reason: string }[];
  pinnedMissing: string[];
};

export type ModelVersionsAlertResult =
  | { skipped: "nothing_to_send" | "no_recipient" | "no_from_address" }
  | { sent: true };

export function hasAlertEvents(e: ModelVersionsAlertEvents): boolean {
  return e.adopted.length + e.failed.length + e.pinnedMissing.length > 0;
}

export function buildModelVersionsAlert(e: ModelVersionsAlertEvents): {
  subject: string;
  text: string;
} {
  const parts: string[] = [];
  const subjectBits: string[] = [];
  if (e.adopted.length > 0) {
    subjectBits.push(`versão nova em uso: ${e.adopted.map((a) => a.id).join(", ")}`);
    parts.push(
      [
        "Versões novas adotadas (passaram na sondagem e já rodam no lugar da conferida):",
        ...e.adopted.map(
          (a) =>
            `- ${a.id} (fallback: ${a.pinnedId}). Preço ESTIMADO pelo da conferida: $${a.inputPricePerMTok} in / $${a.outputPricePerMTok} out por 1M. Confirme o preço oficial em /admin/settings.`,
        ),
      ].join("\n"),
    );
  }
  if (e.failed.length > 0) {
    subjectBits.push(`versão reprovada: ${e.failed.map((f) => f.id).join(", ")}`);
    parts.push(
      [
        "Versões reprovadas ou rebaixadas (a família volta pra conferida):",
        ...e.failed.map((f) => `- ${f.id}: ${f.reason}`),
      ].join("\n"),
    );
  }
  if (e.pinnedMissing.length > 0) {
    subjectBits.push(`conferida fora da API: ${e.pinnedMissing.join(", ")}`);
    parts.push(
      [
        "Versões conferidas que sumiram da listagem da API (o fallback pode parar de funcionar; atualize lib/ai/models.ts):",
        ...e.pinnedMissing.map((id) => `- ${id}`),
      ].join("\n"),
    );
  }
  return {
    subject: `[Palpiteiro] Modelos: ${subjectBits.join("; ")}`,
    text: `${parts.join("\n\n")}\n\nAviso automático do cron check-model-versions.`,
  };
}

/**
 * Envia o aviso. Sem evento, destinatário ou remetente, não envia (devolve o motivo).
 * Erro do Resend LANÇA: quem chama (o cron) decide não deixar isso derrubar a checagem.
 */
export async function sendModelVersionsAlert(
  events: ModelVersionsAlertEvents,
): Promise<ModelVersionsAlertResult> {
  if (!hasAlertEvents(events)) return { skipped: "nothing_to_send" };
  const to = process.env.SPEND_ALERT_EMAIL;
  if (!to) {
    console.warn(
      JSON.stringify({ scope: "model_versions_alert", event: "no_recipient" }),
    );
    return { skipped: "no_recipient" };
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.error(
      JSON.stringify({ scope: "model_versions_alert", event: "no_from_address" }),
    );
    return { skipped: "no_from_address" };
  }
  const { subject, text } = buildModelVersionsAlert(events);
  const resend = new Resend(process.env.AUTH_RESEND_KEY);
  // resend.emails.send() devolve erro de API RESOLVIDO ({ data: null, error }).
  const { error } = await resend.emails.send({ from, to, subject, text });
  if (error) {
    throw new Error(`resend send failed: ${error.message ?? error.name}`);
  }
  return { sent: true };
}
