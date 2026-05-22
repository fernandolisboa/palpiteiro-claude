/**
 * PREVIEW-ONLY (issue #9): toda a página é client component pra simular o state
 * machine idle → loading → OVER/UNDER/PASS via ?state=… e clique no CTA.
 *
 * Na issue #9 isso vira:
 *   - server component que faz fetch do match + última predição via Drizzle;
 *   - client islands isolados: <AnalyzeCTA> com useFormStatus pro botão, server
 *     action que persiste em ai_calls + predictions, error.tsx boundary pra
 *     falha de validação Zod, loading.tsx pro Suspense.
 *   - getFixtureById sai; entra getMatchById(id) tipado.
 *
 * Não construir lógica nova assumindo client-side rendering — qualquer regra
 * que tem que sobreviver à issue #9 mora em lib/, não aqui.
 *
 * Também: o id do match aqui é slug (pal-fla), na issue #9 vira UUID.
 * Não fazer split/regex sobre o id; tratar como string opaca em qualquer lugar.
 */

import { notFound } from "next/navigation";

import { getFixtureById } from "@/lib/fixtures";
import { MatchScreen } from "./match-screen";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MatchPage({ params }: PageProps) {
  const { id } = await params;
  const fixture = getFixtureById(id);
  if (!fixture) notFound();
  return <MatchScreen fixture={fixture} />;
}
