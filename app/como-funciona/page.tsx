import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { ThemeToggle } from "@/components/theme-toggle";

import { ComoFuncionaContent } from "./como-funciona-content";

export const metadata: Metadata = {
  title: "Como funciona · Palpiteiro",
  description:
    "Entenda over/under 2.5, edge, PASS e cada número do Palpiteiro — tutorial pra iniciante total e glossário.",
};

/**
 * Página pública `/como-funciona` (sem login). Server Component que **NÃO**
 * chama `auth()` — o conteúdo é idêntico pra todos e a rota é liberada no
 * middleware. Não usa `DesktopShell`/`PageHeader` (ambos gateiam por sessão):
 * monta um header próprio enxuto (wordmark + ThemeToggle) + `BackLink`.
 *
 * O corpo vive em `ComoFuncionaContent` (síncrono) pra que o teste de contrato
 * consiga `renderToStaticMarkup` sem aguardar Server Component async.
 */
export default function ComoFuncionaPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-6">
        <div className="flex items-baseline gap-3">
          <span className="text-[17px] font-semibold tracking-[-0.04em]">
            palpiteiro
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-fg-2 sm:inline">
            como funciona
          </span>
        </div>
        <ThemeToggle />
      </header>

      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <BackLink href="/" label="jogos" />
        <ComoFuncionaContent />
      </div>
    </div>
  );
}
