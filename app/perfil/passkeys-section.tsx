"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/webauthn";
import { KeyRound } from "lucide-react";

import { removePasskey } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import type { AuthenticatorSummary } from "@/lib/db/queries/authenticators";

type Props = {
  // Passkeys do usuário, resolvidas no server (serializável). A re-leitura após
  // registrar/remover vem de router.refresh().
  authenticators: AuthenticatorSummary[];
};

// Rótulo amigável a partir do device type + flag de backup (o provider não
// captura nickname). Não mostra o credentialID cru completo.
function deviceLabel(a: AuthenticatorSummary): string {
  const base =
    a.credentialDeviceType === "multiDevice"
      ? "Passkey sincronizada"
      : "Passkey deste dispositivo";
  return a.credentialBackedUp ? `${base} · com backup` : base;
}

/**
 * Gerência de passkeys no /perfil (#255). Client component porque registrar é
 * cerimônia de BROWSER: `signIn("passkey", { action: "register" })` de
 * next-auth/webauthn dispara `startRegistration` de @simplewebauthn/browser. O
 * registro exige sessão autenticada — já garantida pela page (guard de
 * session.user.id). `redirect: false` mantém o feedback nesta página. Remover é
 * server action (`removePasskey`) com gate de dono. router.refresh() repopula a
 * lista após cada operação.
 */
export function PasskeysSection({ authenticators }: Props) {
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onRegister() {
    setRegistering(true);
    setMessage(null);
    try {
      const res = await signIn("passkey", {
        action: "register",
        redirect: false,
      });
      if (res?.ok) {
        setMessage({ ok: true, text: "Passkey registrada." });
        router.refresh();
      } else {
        setMessage({
          ok: false,
          text: "Não foi possível registrar a passkey. Tente novamente.",
        });
      }
    } catch {
      setMessage({
        ok: false,
        text: "Cerimônia de registro cancelada ou indisponível.",
      });
    } finally {
      setRegistering(false);
    }
  }

  function onRemove(credentialID: string) {
    setRemovingId(credentialID);
    setMessage(null);
    const formData = new FormData();
    formData.set("credentialID", credentialID);
    startTransition(async () => {
      const res = await removePasskey(null, formData);
      setRemovingId(null);
      if (res.ok) {
        setMessage({ ok: true, text: "Passkey removida." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error ?? "Falha ao remover." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {authenticators.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<KeyRound className="size-10" strokeWidth={1.25} />}
          title="Nenhuma passkey registrada."
          description="Uma passkey deixa você entrar com biometria ou PIN do dispositivo, sem senha nem link por e-mail."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {authenticators.map((a) => (
            <li
              key={a.credentialID}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-body">{deviceLabel(a)}</span>
                <span className="text-muted-foreground font-mono text-eyebrow">
                  {a.credentialID.slice(0, 12)}…
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={removingId === a.credentialID}
                onClick={() => onRemove(a.credentialID)}
                className="text-destructive hover:text-destructive"
              >
                {removingId === a.credentialID ? "Removendo…" : "Remover"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        disabled={registering}
        onClick={onRegister}
        className="w-fit"
      >
        {registering ? "Registrando…" : "Registrar passkey"}
      </Button>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          aria-live={message.ok ? "polite" : "assertive"}
          className={
            message.ok
              ? "text-edge-fg text-body"
              : "text-body text-destructive"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
