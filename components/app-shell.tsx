import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/lib/auth/session";
import { MobileNav } from "@/components/mobile-nav";
import { AccountMenu, type Viewer } from "@/components/nav/account-menu";
import { DesktopNav } from "@/components/nav/desktop-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

/**
 * Casco de toda tela logada (#553): header fixo no topo com o menu completo, no
 * celular (☰) e no computador (barra). Renderizado UMA vez pelo layout do grupo
 * `app/(app)/`, então nenhuma página logada fica sem menu e o header não remonta
 * entre navegações. `/como-funciona` (pública) usa o mesmo casco: logado vê o menu,
 * anônimo vê só a marca, o tema e "entrar".
 */
export async function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <AppHeader viewer={await readViewer()} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

/**
 * Falha ao ler a sessão (DB fora do ar na revalidação do token) não pode derrubar o
 * layout: o erro subiria acima dos `error.tsx` das rotas e cairia no global-error.
 * Nesse caso o header sai com o menu básico (sem admin, sem conta) e a página decide.
 */
async function readViewer(): Promise<Viewer | null> {
  try {
    const user = (await getSession())?.user;
    if (!user) return null;
    return {
      label: user.name?.trim() || user.email || "",
      email: user.email ?? null,
      image: user.image ?? null,
      isAdmin: user.role === "admin",
    };
  } catch (error) {
    // Erros internos do Next (uso dinâmico de cookies no build, redirect) seguem adiante.
    unstable_rethrow(error);
    Sentry.captureException(error);
    return { label: "", email: null, image: null, isAdmin: false };
  }
}

export function AppHeader({ viewer }: { viewer: Viewer | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/90 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-1.5 lg:gap-7">
          {viewer && <MobileNav isAdmin={viewer.isAdmin} className="lg:hidden" />}
          <Link
            href={viewer ? "/jogos" : "/"}
            aria-label={viewer ? "palpiteiro, ir para jogos" : "palpiteiro, página inicial"}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Wordmark
              suffix="v0 · edge multi-mercado"
              suffixClassName="hidden 2xl:inline"
            />
          </Link>
          {viewer && <DesktopNav isAdmin={viewer.isAdmin} className="hidden lg:flex" />}
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <ThemeToggle />
          {viewer ? (
            viewer.label && <AccountMenu viewer={viewer} />
          ) : (
            <Link
              href="/signin"
              className="rounded-sm font-mono text-meta uppercase tracking-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
