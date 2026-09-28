import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

import { ComoUsarContent } from "./como-usar-content";

export const metadata: Metadata = {
  title: "Como usar",
  description:
    "Guia de uso do Palpiteiro: achar um jogo, gerar o palpite, ler a análise, registrar sua aposta e acompanhar os resultados.",
};

/**
 * Guia de uso `/como-usar` (logado — o botão do tour leva pra `/jogos`, que é
 * gateada). Mesmo casco enxuto do `/como-funciona` (wordmark + tema + voltar), que é
 * o par conceitual desta página.
 */
export default function ComoUsarPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-6">
        <Wordmark suffix="como usar" suffixClassName="hidden sm:inline" />
        <ThemeToggle />
      </header>

      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <BackLink href="/jogos" label="jogos" />
        <ComoUsarContent />
      </div>
    </div>
  );
}
