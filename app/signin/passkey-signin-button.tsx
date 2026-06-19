"use client";

import { useState } from "react";
import { signIn } from "next-auth/webauthn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Botão de login por passkey (#263). A cerimônia WebAuthn roda no BROWSER —
 * `signIn` de `next-auth/webauthn` busca as opções em /api/auth/webauthn-options
 * e chama `startAuthentication`/`startRegistration` de `@simplewebauthn/browser`.
 * Por isso é client component: a server action `signIn("passkey")` de `@/auth`
 * NÃO dispara a cerimônia (passo load-bearing do plano).
 *
 * O `getUserInfo` default do provider localiza o usuário pelo param `email`, então
 * o campo de e-mail é o caminho sólido sem depender de conditional UI/autofill.
 * `redirect: false` é o que permite mostrar erro inline (whitelist, e-mail sem
 * passkey, cerimônia abortada) sem sair da página — com `redirect: true` o helper
 * faz `window.location.href` e não devolve o erro.
 */
/**
 * `enabled` (#282): gate de maioridade do /signin. O wrapper passa
 * `canSubmit(accepted)`; enquanto o checkbox 18+ não estiver marcado, o botão
 * fica desabilitado junto das outras condições (`pending || !email`). Default
 * `true` pra não regredir um call-site sem o gate (defensivo — hoje só há um).
 */
export function PasskeySignInButton({ enabled = true }: { enabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const res = await signIn("passkey", {
        email,
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
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-eyebrow tracking-label uppercase">
          e-mail (passkey)
        </span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username webauthn"
          placeholder="voce@exemplo.com"
        />
      </label>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending || !email || !enabled}
        onClick={onClick}
      >
        {pending ? "Verificando…" : "Entrar com passkey"}
      </Button>
      {error && (
        <p className="text-destructive text-body-sm tracking-tight">{error}</p>
      )}
    </div>
  );
}
