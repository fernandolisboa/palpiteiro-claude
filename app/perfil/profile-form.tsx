"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        <span className="text-muted-foreground text-eyebrow font-mono tracking-label uppercase">
          e-mail
        </span>
        <Input
          type="email"
          value={email}
          disabled
          readOnly
          className="max-w-aside text-muted-foreground"
        />
        <span className="text-muted-foreground text-meta">
          O e-mail é a sua identidade de login e não é editável aqui.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-eyebrow font-mono tracking-label uppercase">
          nome
        </span>
        <Input
          type="text"
          name="name"
          required
          maxLength={80}
          defaultValue={initialName}
          placeholder="Seu nome"
          className="max-w-aside"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-eyebrow font-mono tracking-label uppercase">
          avatar (URL)
        </span>
        <Input
          type="url"
          name="image"
          defaultValue={initialImage}
          placeholder="https://…"
          className="max-w-aside"
        />
        <span className="text-muted-foreground text-meta">
          Cole a URL de uma imagem. Deixe em branco pra usar as iniciais.
        </span>
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar"}
      </Button>

      {state &&
        (state.ok ? (
          <p className="text-edge-fg text-body" role="status" aria-live="polite">
            Perfil atualizado.
          </p>
        ) : (
          <p
            className="text-body text-destructive"
            role="alert"
            aria-live="assertive"
          >
            {state.error}
          </p>
        ))}
    </form>
  );
}
