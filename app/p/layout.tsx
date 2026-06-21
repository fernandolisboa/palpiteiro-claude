import type { Metadata } from "next";

import { NEUTRAL_DESCRIPTION } from "@/app/p/[id]/load-shared-palpite";

// Metadata DEFAULT do segmento público /p (#416, privacy MAJOR 3 — defense-in-depth): declara
// a description NEUTRA + noindex/nofollow como INVARIANTE do segmento, herdada por TODA boundary
// sob /p (page, not-found e qualquer error.tsx/rota futura). Sem este piso, uma boundary nova
// sem export próprio cascateia a description "Recomendações de aposta…" da root layout pra
// og:description numa superfície pública regulatória (foi o que o HARD-404 do not-found expôs).
// A page (generateMetadata) e o not-found.tsx reafirmam os mesmos valores — redundância
// INTENCIONAL: cada boundary fica protegida pelo seu próprio export E pelo piso do segmento.
// NÃO renderiza chrome (o <html>/<body> é da root layout) — só repassa children.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  description: NEUTRAL_DESCRIPTION,
  openGraph: { description: NEUTRAL_DESCRIPTION },
};

export default function PublicSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
