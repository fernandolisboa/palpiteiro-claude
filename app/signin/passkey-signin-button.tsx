"use client";

import { useState } from "react";
import { signIn } from "next-auth/webauthn";

import { Button } from "@/components/ui/button";

/**
 * Botão de login por passkey (#263). A cerimônia WebAuthn roda no BROWSER —
 * `signIn` de `next-auth/webauthn` busca as opções em /api/auth/webauthn-options
 * e chama `startAuthentication`/`startRegistration` de `@simplewebauthn/browser`.
 * Por isso é client component: a server action `signIn("passkey")` de `@/auth`
 * NÃO dispara a cerimônia (passo load-bearing do plano).
 *
 * O `getUserInfo` default do provider localiza o usuário pelo param `email`: e-mail
 * com passkey → authenticate; e-mail novo → register. O campo é o mesmo do link por
 * e-mail (#579): o wrapper detém o estado e passa `email`. O clique normaliza igual ao
 * `sendMagicLink` (trim + minúsculas): o adapter compara o e-mail sensível a caixa e
 * grava em minúsculas, então "Fulano@x.com" sem normalizar cairia no `register` e
 * criaria uma segunda conta.
 *
 * `redirect: false` é o que permite mostrar erro inline (whitelist, e-mail sem
 * passkey, cerimônia abortada) sem sair da página — com `redirect: true` o helper
 * faz `window.location.href` e não devolve o erro.
 *
 * `type="button"`: vive dentro do `<form>` do link e não pode submetê-lo. O Enter no
 * campo usa o primeiro submit do form ("Enviar link de acesso"), que vem antes deste
 * botão e fica desabilitado enquanto o 18+ não está marcado.
 *
 * `enabled` (#282): gate de maioridade do /signin. O wrapper passa
 * `canSubmit(accepted)`; enquanto o checkbox 18+ não estiver marcado, o botão
 * fica desabilitado junto das outras condições (`pending || !email`). Default
 * `true` pra não regredir um call-site sem o gate (defensivo — hoje só há um).
 */
export function PasskeySignInButton({
  email,
  enabled = true,
  describedBy,
}: {
  email: string;
  enabled?: boolean;
  describedBy?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const res = await signIn("passkey", {
        email: email.trim().toLowerCase(),
        redirect: false,
        redirectTo: "/jogos",
      });
      // `redirect: false` devolve { ok, error, url }. O ramo de sucesso depende de
      // a lib ANULAR `url` em caso de erro client-safe (ex.: AccessDenied retorna
      // status 200, então `res.ok === true`, mas o helper zera `url`), por isso
      // `res.ok && res.url` separa sucesso de erro — não basta `res.ok`. Sucesso →
      // navega manual; erro → cai no setError abaixo (inline, sem sair da página).
      if (res?.ok && res.url) {
        window.location.href = res.url;
        return;
      }
      setError(
        res?.error === "AccessDenied"
          ? "Este e-mail não está autorizado ou não tem passkey registrada."
          : "Não foi possível entrar com passkey. Tente novamente.",
      );
    } catch {
      // startAuthentication lança se o usuário cancelar a cerimônia ou não houver
      // credencial — tratar como erro inline, não derrubar a página.
      setError("Cerimônia de passkey cancelada ou indisponível.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending || !email.trim() || !enabled}
        aria-describedby={describedBy}
        onClick={onClick}
      >
        {pending ? "Verificando…" : "Entrar com passkey"}
      </Button>
      {error && (
        <p className="text-destructive text-body-sm tracking-tight">{error}</p>
      )}
    </>
  );
}
