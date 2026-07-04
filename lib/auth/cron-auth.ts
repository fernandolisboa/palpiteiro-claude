import { timingSafeEqual } from "node:crypto";

// Autenticação compartilhada pelos 5 crons (report 01 achado #6). O Vercel Cron envia
// `Authorization: Bearer <CRON_SECRET>` automaticamente; esta função valida esse header.
//
// Fail-closed: sem CRON_SECRET configurado, rejeita como qualquer caller não-autorizado
// (loga o motivo real com o escopo do cron, mas devolve false — nunca 5xx que o
// scheduler re-tentaria). O escopo entra só no log de config; a resposta 401 fica no
// route, idêntica pros dois casos (secret ausente ou header divergente).
//
// Comparação em tempo constante: `header !== \`Bearer ${secret}\`` curto-circuita no
// primeiro byte divergente, o que teoricamente vaza timing. Inviável contra um token de
// alta entropia sob jitter serverless, mas é defense-in-depth barato.
export function isAuthorizedCron(request: Request, scope: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ scope, event: "missing_cron_secret" }));
    return false;
  }
  const header = request.headers.get("authorization");
  if (header === null) return false;
  return timingSafeCompare(header, `Bearer ${secret}`);
}

// timingSafeEqual EXIGE buffers de igual tamanho (throw caso contrário). Guarda o length
// primeiro — isso revela só o COMPRIMENTO do header, nunca o conteúdo, e o tamanho
// esperado ("Bearer " + secret) já é público/fixo, então não há vazamento útil.
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
