import type { Metadata } from "next";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

import { LandingContent } from "./landing-content";

export const metadata: Metadata = {
  title: "Palpiteiro · um palpite por jogo, com racional",
  description:
    "Motor de seleção de edge multi-mercado que emite UM palpite por jogo, com racional — resultado, total de gols, ambas marcam e dupla chance. Leitura pronta, análise como detalhe.",
  openGraph: {
    title: "Palpiteiro · um palpite por jogo, com racional",
    description:
      "Motor de seleção de edge multi-mercado que emite UM palpite por jogo, com racional. A IA escolhe o mercado, você lê o porquê.",
    type: "website",
  },
};

/**
 * Landing pública estática na raiz `/` (#373). Server Component que **NÃO**
 * chama `auth()` nem toca DB/Odds-API/IA — a rota é liberada no middleware via
 * exclusão de matcher (`$`). Não usa `DesktopShell`/`PageHeader` (ambos gateiam
 * por sessão): monta o mesmo header enxuto público de `/como-funciona`
 * (wordmark + ThemeToggle). A home autenticada vive em `/jogos`.
 *
 * O corpo vive em `LandingContent` (síncrono) pra que o teste de contrato
 * consiga `renderToStaticMarkup` sem aguardar Server Component async.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-6">
        <Wordmark suffix="edge multi-mercado" suffixClassName="hidden sm:inline" />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-reading px-6">
        <LandingContent />
      </main>
    </div>
  );
}
