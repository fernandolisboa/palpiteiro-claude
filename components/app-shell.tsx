import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";

import { getSession } from "@/lib/auth/session";
import { AccountMenu, type Viewer } from "@/components/nav/account-menu";
import { DesktopNav } from "@/components/nav/desktop-nav";
import { MobileTabBar } from "@/components/nav/mobile-tab-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

/**
 * Casco de toda tela logada (#553): header fixo no topo com o menu completo no
 * computador; no celular, barra de abas fixa embaixo (#633). Renderizado UMA vez pelo layout do grupo
 * `app/(app)/`, então nenhuma página logada fica sem menu e o header não remonta
 * entre navegações. `/como-funciona` (pública) usa o mesmo casco: logado vê o menu,
 * anônimo vê só a marca, o tema e "entrar".
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      {/* A sessão revalida o token no DB (cold start do Neon ~1s). Em Suspense, o
          conteúdo e os `loading.tsx` das rotas não esperam o header. */}
      <Suspense fallback={<AppHeader viewer="pending" />}>
        <SessionHeader />
      </Suspense>
      <div className="flex-1">{children}</div>
      {/* Fora do <header>: o backdrop-blur dele vira containing block de `fixed`. */}
      <Suspense fallback={null}>
        <SessionTabBar />
      </Suspense>
    </div>
  );
}

async function SessionHeader() {
  return <AppHeader viewer={await readViewer()} />;
}

async function SessionTabBar() {
  const viewer = await readViewer();
  return viewer ? <MobileTabBar isAdmin={viewer.isAdmin} /> : null;
}

/**
 * Falha ao ler a sessão (DB fora do ar na revalidação do token) não pode derrubar o
 * layout: o erro subiria acima dos `error.tsx` das rotas e cairia no global-error.
 * Nesse caso o header sai com o menu básico (sem admin, sem conta) e a página decide.
 * `cache`: header e barra de abas leem a sessão uma vez só por request.
 */
const readViewer = cache(async (): Promise<Viewer | null> => {
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
});

/** `null` = anônimo; `"pending"` = sessão ainda carregando (só marca e tema). */
export function AppHeader({ viewer: state }: { viewer: Viewer | null | "pending" }) {
  const pending = state === "pending";
  const viewer = pending ? null : state;
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/90 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-7">
          <Link
            // "/" leva o logado pra /jogos (middleware) e o anônimo pra landing.
            href={viewer ? "/jogos" : "/"}
            aria-label={viewer ? "palpiteiro, ir para jogos" : "palpiteiro, página inicial"}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Wordmark />
          </Link>
          {viewer && <DesktopNav isAdmin={viewer.isAdmin} className="hidden lg:flex" />}
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <ThemeToggle />
          {pending ? null : viewer ? (
            <AccountMenu viewer={viewer} />
          ) : (
            <Link
              href="/signin"
              className="rounded-sm text-meta uppercase tracking-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
