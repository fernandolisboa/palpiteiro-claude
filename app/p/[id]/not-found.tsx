import type { Metadata } from "next";

import { Wordmark } from "@/components/wordmark";
import { NEUTRAL_DESCRIPTION } from "@/app/p/[id]/load-shared-palpite";

// Metadata do 404 público (#416, privacy MAJOR 3): no HARD-404 (sem loading.tsx, page.tsx
// #416) o Next descarta o generateMetadata da página e resolve a metadata DESTA boundary —
// que, sem export próprio, cascateia a description "Recomendações de aposta…" da root layout
// pra og:description num dead-link público regulatório. Reafirmamos a description NEUTRA aqui
// (espelha o branch no-data do generateMetadata da page) + noindex/nofollow. SEM isto, o 404
// semântico vaza linguagem de valor. Verificado com curl no head do dead-link.
// O app/p/layout.tsx declara o MESMO piso pro segmento inteiro — redundância intencional
// (defense-in-depth): este export protege o 404 independente do comportamento de herança da
// metadata do layout na boundary not-found.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  description: NEUTRAL_DESCRIPTION,
  openGraph: { description: NEUTRAL_DESCRIPTION },
};

// 404 público mínimo do /p (ADR 0035 §6 / #384): cobre o kill-switch (set sem shared_at →
// getSharedPalpiteSet null → notFound) E os 3 triggers de 404, pousando numa casca pública
// limpa (sem nav/DesktopShell autenticados). Não é o 404 da raiz autenticada/landing.
export default function PublicPalpiteNotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-5 py-4">
        <Wordmark />
      </header>
      <div className="mx-auto flex w-full max-w-content flex-col gap-2 px-5 py-16">
        <h1 className="text-display-md font-medium tracking-tight">
          Esse palpite não está disponível.
        </h1>
        <p className="text-body tracking-tight text-muted-foreground">
          O link pode ter expirado ou o palpite deixou de ser compartilhado.
        </p>
      </div>
    </main>
  );
}
