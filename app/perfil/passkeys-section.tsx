"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/webauthn";

import { removePasskey } from "@/app/actions/profile";
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
        <p className="text-muted-foreground text-[13px]">
          Nenhuma passkey registrada. Uma passkey deixa você entrar com
          biometria ou PIN do dispositivo, sem senha nem link por e-mail.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {authenticators.map((a) => (
            <li
              key={a.credentialID}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-[13px]">{deviceLabel(a)}</span>
                <span className="text-muted-foreground font-mono text-[10px]">
                  {a.credentialID.slice(0, 12)}…
                </span>
              </div>
              <button
                type="button"
                disabled={removingId === a.credentialID}
                onClick={() => onRemove(a.credentialID)}
                className="border-border rounded-md border px-3 py-1.5 text-[12.5px] text-red-500 disabled:opacity-50"
              >
                {removingId === a.credentialID ? "Removendo…" : "Remover"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={registering}
        onClick={onRegister}
        className="border-border bg-foreground text-background w-fit rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {registering ? "Registrando…" : "Registrar passkey"}
      </button>

      {message && (
        <p
          className={
            message.ok
              ? "text-accent-fg text-[13px]"
              : "text-[13px] text-red-500"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
