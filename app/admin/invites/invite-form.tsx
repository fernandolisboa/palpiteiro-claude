"use client";

import { useActionState } from "react";

import { inviteUser, type InviteUserResult } from "@/app/actions/invites";

export function InviteForm() {
  const [state, action, pending] = useActionState<
    InviteUserResult | null,
    FormData
  >(inviteUser, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          e-mail
        </span>
        <input
          type="email"
          name="email"
          required
          placeholder="pessoa@exemplo.com"
          className="border-border w-80 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          nota (opcional)
        </span>
        <input
          type="text"
          name="note"
          className="border-border w-80 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <p className="text-muted-foreground text-[12px]">
        Autoriza o e-mail a logar sem redeploy. Vale assim que o convite é
        adicionado.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="border-border bg-foreground text-background w-fit rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Convidando…" : "Convidar"}
      </button>

      {state &&
        (state.ok ? (
          state.emailed === false ? (
            <p className="text-[13px] text-amber-500">
              Convite adicionado, mas não consegui enviar o e-mail de aviso —
              avise a pessoa manualmente.
            </p>
          ) : (
            <p className="text-accent-fg text-[13px]">
              Convite adicionado. E-mail de aviso enviado.
            </p>
          )
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
