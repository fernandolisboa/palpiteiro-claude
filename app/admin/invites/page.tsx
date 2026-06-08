import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { listPendingInvites } from "@/lib/db/queries/invites";

import { InviteForm } from "./invite-form";
import { RevokeButton } from "./revoke-button";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminInvitesPage() {
  const invites = await listPendingInvites();

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 pb-6"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">
          Convidar Usuários
        </h1>
        <p className="text-muted-foreground pb-6 font-mono text-[11px]">
          whitelist · admin autoriza login sem redeploy
        </p>

        <section className="pb-8">
          <h2 className="text-muted-foreground pb-3 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            novo convite
          </h2>
          <InviteForm />
        </section>

        <section>
          <h2 className="text-muted-foreground pb-3 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            convites pendentes
          </h2>
          {invites.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">
              Nenhum convite pendente.
            </p>
          ) : (
            <div className="border-border rounded-md border">
              {invites.map((invite) => (
                <div
                  key={invite.email}
                  className="border-border flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium">
                      {invite.email}
                    </span>
                    {invite.note ? (
                      <span className="text-muted-foreground font-mono text-[10.5px]">
                        {invite.note}
                      </span>
                    ) : null}
                  </div>
                  <RevokeButton email={invite.email} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
