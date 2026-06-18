"use client";

import { useActionState } from "react";

import {
  setUserAccess,
  setUserRole,
  type AdminUserResult,
} from "@/app/actions/admin-users";

type Props = {
  userId: string;
  role: "admin" | "user";
  allowed: boolean;
  isSelf: boolean;
};

function Status({ state }: { state: AdminUserResult | null }) {
  if (!state) return null;
  return state.ok ? (
    <span className="text-accent-fg text-body-sm">Atualizado.</span>
  ) : (
    <span className="text-body-sm text-destructive">{state.error}</span>
  );
}

export function UserAdminControls({ userId, role, allowed, isSelf }: Props) {
  const [roleState, roleAction, rolePending] = useActionState<
    AdminUserResult | null,
    FormData
  >(setUserRole, null);
  const [accessState, accessAction, accessPending] = useActionState<
    AdminUserResult | null,
    FormData
  >(setUserAccess, null);

  const nextRole = role === "admin" ? "user" : "admin";

  return (
    <section className="border-border mb-8 rounded-md border">
      <div className="border-border border-b px-4 py-3">
        <h2 className="text-muted-foreground font-mono text-eyebrow tracking-label uppercase">
          controle de acesso
        </h2>
        {isSelf && (
          <p className="text-muted-foreground pt-1 text-body-sm">
            Esta é a sua conta — você não pode alterar a própria role nem
            revogar o próprio acesso.
          </p>
        )}
      </div>

      <div className="border-border flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex flex-col">
          <span className="text-body font-medium">Role</span>
          <span className="text-muted-foreground font-mono text-eyebrow uppercase">
            {role}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Status state={roleState} />
          <form action={roleAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="role" value={nextRole} />
            <button
              type="submit"
              disabled={rolePending || isSelf}
              className="border-border rounded-md border px-3 py-1.5 text-body-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {role === "admin" ? "Rebaixar p/ usuário" : "Tornar admin"}
            </button>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-body font-medium">Acesso</span>
          <span className="text-muted-foreground font-mono text-eyebrow uppercase">
            {allowed ? "permitido" : "revogado"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Status state={accessState} />
          <form action={accessAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="allowed" value={String(!allowed)} />
            <button
              type="submit"
              disabled={accessPending || (isSelf && allowed)}
              className="border-border rounded-md border px-3 py-1.5 text-body-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {allowed ? "Revogar acesso" : "Conceder acesso"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
