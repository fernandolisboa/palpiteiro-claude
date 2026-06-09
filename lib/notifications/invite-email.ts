import { Resend } from "resend";

/**
 * Envia o e-mail de AVISO de convite ao convidado. NÃO é o magic link — o link
 * de acesso só é gerado quando a pessoa o solicita em /signin (fluxo do
 * Auth.js). Mantém o `resend.emails.send` isolado em lib/notifications, junto do
 * spend-alert, conforme as fronteiras do CLAUDE.md.
 *
 * Nunca lança: quando isto roda o convite (whitelist) já está válido, então uma
 * falha de e-mail é soft (retorna `{ sent: false, reason }`) pra action não
 * derrubar o convite. Falhas são logadas pra observabilidade.
 */
export type InviteEmailResult =
  | { sent: true }
  | { sent: false; reason: "no_from_address" | "no_api_key" | "send_failed" };

export async function sendInviteEmail(params: {
  to: string;
  signinUrl: string;
}): Promise<InviteEmailResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.error(
      JSON.stringify({ scope: "invite_email", event: "no_from_address" })
    );
    return { sent: false, reason: "no_from_address" };
  }
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    console.error(
      JSON.stringify({ scope: "invite_email", event: "no_api_key" })
    );
    return { sent: false, reason: "no_api_key" };
  }

  const subject = "Você foi convidado pro Palpiteiro";
  const text = [
    "Você foi convidado pra usar o Palpiteiro.",
    "",
    `Acesse ${params.signinUrl} e peça seu link de acesso usando este mesmo e-mail.`,
    "",
    "Isto é só um aviso — não é um link de login. O link mágico de acesso é",
    "gerado na hora em que você o solicita na página de entrada.",
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    // resend.emails.send() devolve erro de API como `{ data: null, error }`
    // RESOLVIDO (não rejeitado) — espelha o spend-alert. Aqui NÃO relançamos: o
    // convite já é válido, então degradamos pra soft-fail.
    const { error } = await resend.emails.send({
      from,
      to: params.to,
      subject,
      text,
    });
    if (error) {
      console.error(
        JSON.stringify({
          scope: "invite_email",
          event: "send_failed",
          message: error.message ?? error.name,
        })
      );
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "invite_email",
        event: "send_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return { sent: false, reason: "send_failed" };
  }
}
