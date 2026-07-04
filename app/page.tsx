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
  alternates: { canonical: "/" },
};

// JSON-LD Organization + WebSite (SEO baseline, #443). Const estático tipado —
// NENHUM input de usuário flui aqui, então serializar com JSON.stringify e injetar
// via dangerouslySetInnerHTML é seguro (sem risco de XSS). `url` espelha o
// metadataBase (app/layout.tsx). SportsEvent/Article ficam deferidos (flip do /p, blog).
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Palpiteiro",
      url: "https://palpiteiro.live",
    },
    {
      "@type": "WebSite",
      name: "Palpiteiro",
      url: "https://palpiteiro.live",
      inLanguage: "pt-BR",
    },
  ],
} as const;

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
      <script
        type="application/ld+json"
        // Server-rendered no HTML da landing (Server Component) — sem hidratação.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
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
