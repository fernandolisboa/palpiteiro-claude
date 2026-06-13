import Link from "next/link";
import type { ReactNode } from "react";

import { auth, signOut } from "@/auth";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import { ThemeToggle } from "@/components/theme-toggle";

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
          <div className="flex items-baseline gap-3">
            <span className="text-[17px] font-semibold tracking-[-0.04em]">
              palpiteiro
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-fg-2 sm:inline">
              v0 · edge multi-mercado
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/"
              className="text-[12.5px] tracking-tight text-muted-foreground transition-colors hover:text-foreground"
            >
              jogos
            </Link>
            <Link
              href="/dashboard"
              className="text-[12.5px] tracking-tight text-muted-foreground transition-colors hover:text-foreground"
            >
              dashboard
            </Link>
            <Link
              href="/como-funciona"
              className="text-[12.5px] tracking-tight text-muted-foreground transition-colors hover:text-foreground"
            >
              como funciona
            </Link>
            {user?.role === "admin" && (
              <Link
                href="/admin"
                className="text-[12.5px] tracking-tight text-muted-foreground transition-colors hover:text-foreground"
              >
                admin
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {label && (
            <>
              <Link
                href="/perfil"
                aria-label="Perfil"
                className="flex items-center gap-2 transition-opacity hover:opacity-80"
              >
                <UserAvatar
                  initials={initialsFrom(label)}
                  hue={258}
                  size={26}
                  src={user?.image ?? null}
                />
                <span className="text-[12.5px] tracking-tight">{label}</span>
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
                  className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
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
