"use client";

import { useActionState } from "react";

import {
  setUserAccess,
  setUserRole,
  type AdminUserResult,
} from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";

type Props = {
  userId: string;
  role: "admin" | "user";
  allowed: boolean;
  isSelf: boolean;
};

function Status({ state }: { state: AdminUserResult | null }) {
  if (!state) return null;
  return state.ok ? (
    <span
      className="text-edge-fg text-body-sm"
      role="status"
      aria-live="polite"
    >
      Atualizado.
    </span>
  ) : (
    <span
      className="text-body-sm text-destructive"
      role="alert"
      aria-live="assertive"
    >
      {state.error}
    </span>
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
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={rolePending || isSelf}
            >
              {role === "admin" ? "Rebaixar p/ usuário" : "Tornar admin"}
            </Button>
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
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={accessPending || (isSelf && allowed)}
            >
              {allowed ? "Revogar acesso" : "Conceder acesso"}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
