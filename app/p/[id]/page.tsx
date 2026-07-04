import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { PublicPalpite } from "@/components/palpites/public-palpite";
import {
  loadSharedPalpite,
  NEUTRAL_DESCRIPTION,
} from "@/app/p/[id]/load-shared-palpite";

// Snapshot público imutável (ADR 0035 §13): cache longo, revalida a cada 24h. A página é
// pura leitura de DB (sem auth, sem mutação) — o link é resolvível por qualquer um (a
// privacidade é o opt-in shared_at, gateado na query).
export const revalidate = 86400;

// SEM `loading.tsx` nesta rota, DE PROPÓSITO (#416): com um Suspense boundary de loading,
// o Next streama o skeleton (HTTP 200, headers commitados) ANTES de a página resolver, então
// um `notFound()` posterior fica preso em 200 (soft-404). Sem ele, a página AWAIT a query e
// o `notFound()` dispara antes de qualquer byte → 404 semântico real (curl -I confirmado).
// Trade aceito: link a frio (cache-miss) perde o skeleton de Neon cold-start (~1s), mas o
// snapshot válido é cacheado `immutable` (revalidate 24h + Cache-Control do next.config) — o
// cache-miss é raro (1ª view por link/24h; o scraper de OG costuma esquentar o cache antes do
// humano clicar). `generateMetadata` segue intocado → a description NEUTRA (firewall/privacy
// MAJOR 3) continua valendo no head do dead-link, sem cascatear a root "Recomendações de
// aposta". NÃO re-adicionar loading.tsx aqui sem reintroduzir o soft-404.

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Metadata do /p (ADR 0035 §6/§13, privacy MAJOR 3). `robots: noindex,nofollow` SEMPRE.
 * `description` NEUTRA em AMBOS os branches (data E no-data) — sem isso o no-data branch
 * cascateia a description "Recomendações de aposta…" da root layout pro og:description numa
 * superfície pública regulatória. O VEREDITO nunca entra na metadata (só na imagem OG).
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const shared = await loadSharedPalpite(id);

  if (!shared) {
    // No-data: ainda assim seta description neutra (não cai na root "Recomendações de aposta").
    return {
      robots: { index: false, follow: false },
      description: NEUTRAL_DESCRIPTION,
    };
  }

  const { homeTeam, awayTeam } = shared.match;
  const title = `${homeTeam} x ${awayTeam}`;
  return {
    robots: { index: false, follow: false },
    description: NEUTRAL_DESCRIPTION,
    openGraph: {
      title,
      description: NEUTRAL_DESCRIPTION,
      type: "article",
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function PublicPalpitePage({ params }: PageProps) {
  const { id } = await params;
  const shared = await loadSharedPalpite(id);
  if (!shared) notFound();

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Chrome público mínimo e auto-contido: só a marca, sem nav/back/DesktopShell (que
          puxam contexto autenticado). A marca linka pra landing `/` (on-ramp de crescimento,
          #444) — firewall-safe: `/` é pública/estática, sem linguagem de valor. */}
      <header className="border-b border-border/60 px-5 py-4">
        <Link
          href="/"
          className="inline-flex w-fit rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Wordmark />
        </Link>
      </header>
      <div className="mx-auto w-full max-w-content px-5 py-8">
        <PublicPalpite view={shared.view} match={shared.match} />
      </div>
    </main>
  );
}
