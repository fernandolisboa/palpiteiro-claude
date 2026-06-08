"use client";

import { useActionState } from "react";

import { revokeInvite, type InviteUserResult } from "@/app/actions/invites";

type Props = {
  email: string;
};

export function RevokeButton({ email }: Props) {
  const [, action, pending] = useActionState<InviteUserResult | null, FormData>(
    revokeInvite,
    null
  );

  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        className="border-border text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-[12px] disabled:opacity-50"
      >
        {pending ? "Removendo…" : "Remover"}
      </button>
    </form>
  );
}
