import Link from "next/link";
import type { ReactNode } from "react";

import { auth, signOut } from "@/auth";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { NavLink } from "@/components/nav-link";

function initialsFrom(value: string): string {
  const cleaned = value.split("@")[0]?.replace(/[^a-zA-Z]/g, "") ?? "";
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

export async function DesktopShell({ children }: { children: ReactNode }) {
  const session = await auth();
  const user = session?.user;
  const label = user?.name?.trim() || user?.email || "";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-8">
        <div className="flex items-center gap-6">
          <Wordmark
            suffix="v0 · edge multi-mercado"
            suffixClassName="hidden sm:inline"
          />
          <nav
            aria-label="Navegação principal"
            className="flex items-center gap-4"
          >
            <NavLink href="/">jogos</NavLink>
            <NavLink href="/dashboard">dashboard</NavLink>
            <NavLink href="/como-funciona">como funciona</NavLink>
            {user?.role === "admin" && <NavLink href="/admin">admin</NavLink>}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {label && (
            <>
              <Link
                href="/perfil"
                aria-label="Perfil"
                className="flex items-center gap-2 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <UserAvatar
                  initials={initialsFrom(label)}
                  hue={258}
                  size={26}
                  src={user?.image ?? null}
                />
                <span className="text-body-sm tracking-tight">{label}</span>
              </Link>
              <Separator orientation="vertical" className="!h-4" />
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/signin" });
                }}
              >
                <button
                  type="submit"
                  className="font-mono text-meta tracking-label text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  sair
                </button>
              </form>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
