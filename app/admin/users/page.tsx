import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { PageHeading } from "@/components/admin/page-heading";
import { auth } from "@/auth";
import { searchUsers } from "@/lib/db/queries/users";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminUsersPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  // Re-check defensivo: estes dados cruzam usuários (predições/payloads alheios).
  // Defense-in-depth — NÃO confiar só no gate do layout. Espelha costs.
  const session = await auth();
  if (session?.user?.role !== "admin") notFound();

  const usersList = await searchUsers(q);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Usuários"
          subtitle="auditar o tracking de qualquer usuário · busca por e-mail"
        />

        <form
          action="/admin/users"
          className="flex items-center gap-2 pb-6"
        >
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="buscar por e-mail"
            aria-label="buscar por e-mail"
            className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 text-body tracking-tight placeholder:text-muted-fg-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-border bg-card px-4 text-body-sm font-medium tracking-tight hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            buscar
          </button>
        </form>

        {usersList.length === 0 ? (
          <p className="text-body text-muted-foreground">Nenhum usuário.</p>
        ) : (
          <div className="rounded-md border border-border">
            {usersList.map((u) => (
              <Link
                key={u.id}
                href={`/admin/users/${u.id}`}
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="truncate text-body font-medium">
                  {u.email}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  {!u.allowed && (
                    <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-eyebrow uppercase tracking-label text-destructive">
                      bloqueado
                    </span>
                  )}
                  <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                    {u.role}
                  </span>
                  <ChevronRight className="size-3.5 text-muted-fg-2" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
