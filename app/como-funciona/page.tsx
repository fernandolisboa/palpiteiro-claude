import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

import { ComoFuncionaContent } from "./como-funciona-content";

export const metadata: Metadata = {
  title: "Como funciona · Palpiteiro",
  description:
    "Entenda como o Palpiteiro recomenda apostas em over/under, 1X2, ambas marcam e dupla chance — edge, PASS, stake e cada número da tela. Tutorial pra iniciante total e glossário.",
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
        <Wordmark suffix="como funciona" suffixClassName="hidden sm:inline" />
        <ThemeToggle />
      </header>

      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <BackLink href="/jogos" label="jogos" />
        <ComoFuncionaContent />
      </div>
    </div>
  );
}
