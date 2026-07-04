"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import {
  checkMagicLinkIpRateLimit,
  checkMagicLinkRateLimit,
} from "@/lib/auth/magic-link-rate-limit";

// IP do cliente a partir dos headers de proxy (Vercel sempre popula x-forwarded-for em
// prod). Primeiro item da lista = o cliente. Sem header (dev/local sem proxy) → null, e
// o caller pula o teto por-IP (fail-open, coerente com o limiter sem KV).
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return h.get("x-real-ip");
}

// Server actions extraídas do Server Component do /signin (#282): viraram um
// módulo "use server" próprio pra serem importáveis pelo wrapper CLIENT que
// detém o checkbox obrigatório 18+ — o checkbox destrava (disabled) os botões,
// mas a ação em si segue server-side. Comportamento PRESERVADO verbatim do
// estado anterior: normalização de e-mail, rate-limit do magic link, mapeamento
// de erros via redirect e o `redirectTo`.

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/signin?error=MissingEmail");
  // Cost-safety (ADR 0023 §3, #257): com o cadastro aberto, rate-limita o envio
  // ANTES do Resend — cada link é um e-mail pago e 4xx do Resend não é free de
  // quota. Estourou → redirect, NUNCA chega a signIn("resend") → nenhum e-mail.
  //
  // Teto por IP PRIMEIRO (report 01 achado #1 / #435): sem ele, o teto por-e-mail não
  // barra email-bombing (o atacante varia o endereço da vítima a cada 5 envios). Barra na
  // origem antes de tocar o contador por-e-mail. Sem IP nos headers (dev) → pula (fail-open).
  const ip = await clientIp();
  if (ip && !(await checkMagicLinkIpRateLimit(ip))) {
    redirect("/signin?error=RateLimited");
  }
  if (!(await checkMagicLinkRateLimit(email))) {
    redirect("/signin?error=RateLimited");
  }
  // signIn redireciona internamente: sucesso → verifyRequest; e-mail bloqueado
  // → AccessDenied (o callback signIn roda ANTES do envio, então nenhum
  // e-mail/token é gerado). Não capturar — é um redirect do Next.
  await signIn("resend", { email, redirectTo: "/jogos" });
}

export async function signInWithGoogle() {
  // OAuth Google (método primário — ADR 0023). signIn redireciona pro consent do
  // Google; na volta o callback signIn aplica o mesmo gate da whitelist (e-mail
  // não autorizado → AccessDenied), idêntico ao magic link. Não capturar.
  await signIn("google", { redirectTo: "/jogos" });
}
