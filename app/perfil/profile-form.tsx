"use client";

import { useActionState } from "react";

import { updateProfile, type UpdateProfileResult } from "@/app/actions/profile";

type Props = {
  email: string;
  initialName: string;
  initialImage: string;
};

export function ProfileForm({ email, initialName, initialImage }: Props) {
  const [state, action, pending] = useActionState<
    UpdateProfileResult | null,
    FormData
  >(updateProfile, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          e-mail
        </span>
        <input
          type="email"
          value={email}
          disabled
          readOnly
          className="border-border text-muted-foreground w-80 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
        <span className="text-muted-foreground text-[11px]">
          O e-mail é a sua identidade de login e não é editável aqui.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          nome
        </span>
        <input
          type="text"
          name="name"
          required
          maxLength={80}
          defaultValue={initialName}
          placeholder="Seu nome"
          className="border-border w-80 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          avatar (URL)
        </span>
        <input
          type="url"
          name="image"
          defaultValue={initialImage}
          placeholder="https://…"
          className="border-border w-80 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
        <span className="text-muted-foreground text-[11px]">
          Cole a URL de uma imagem. Deixe em branco pra usar as iniciais.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="border-border bg-foreground text-background w-fit rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar"}
      </button>

      {state &&
        (state.ok ? (
          <p className="text-accent-fg text-[13px]">Perfil atualizado.</p>
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
