import type { Metadata } from "next";
import { IntentLink } from "@/components/intent-link";

import { PageContainer } from "@/components/page-container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

import { LandingContent } from "./landing-content";

// Estática de propósito, como /termos e /privacidade. Desde o 404 próprio dinâmico
// (app/not-found.tsx, #574) o Next renderiza a fronteira de 404 da raiz junto da `/` no
// build, e o `connection()` dela tornaria a landing dinâmica. Com force-static o
// connection()/cookies() dessa fronteira não pesam aqui (a `/` existe, então o 404 nunca
// aparece nela) e a landing continua pré-renderizada.
export const dynamic = "force-static";

// Sob demanda ("no jogo que você escolher"): o palpite sai quando alguém pede a análise,
// com limite diário, então a metadata não promete um palpite pra todo jogo (#579, R6).
const LANDING_TITLE = "Palpiteiro · palpites de futebol e bolão entre amigos";
const LANDING_DESCRIPTION =
  "Palpite da IA no jogo que você escolher, com o porquê. Anote suas apostas e o bolão da turma; o app confere o placar e faz a conta. Ferramenta de análise, não é casa de apostas.";

export const metadata: Metadata = {
  // `absolute` opta o título fora do `template: "%s · Palpiteiro"` do root — a
  // string já carrega a marca, então o template duplicaria (" · Palpiteiro").
  title: { absolute: LANDING_TITLE },
  description: LANDING_DESCRIPTION,
  openGraph: {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
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
 * exclusão de matcher (`$`). Não usa o `AppShell` (que lê a sessão e tornaria a
 * landing dinâmica) nem importa o `AppHeader` (o módulo puxa `getSession` → `@/auth`):
 * monta um header público com a geometria do `AppHeader` anônimo (marca, tema e
 * "entrar"). O logado nunca vê a landing (o middleware manda `/` → `/jogos`).
 * `PageContainer width="content"` marca a largura pro rodapé alinhar (ADR 0059).
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
      <header className="flex h-14 items-center justify-between gap-3 border-b border-border-subtle px-4 lg:px-8">
        <IntentLink
          href="/"
          aria-label="palpiteiro, página inicial"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Wordmark />
        </IntentLink>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <ThemeToggle />
          <IntentLink
            href="/signin"
            className="rounded-sm text-meta uppercase tracking-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            entrar
          </IntentLink>
        </div>
      </header>

      <main>
        <PageContainer width="content">
          <LandingContent />
        </PageContainer>
      </main>
    </div>
  );
}
