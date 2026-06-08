import { notFound } from "next/navigation";
import { z } from "zod";

import { PredictionDetail } from "@/components/dashboard/prediction-detail";
import { DesktopShell } from "@/components/desktop-shell";
import { auth } from "@/auth";
import { getPredictionDetailForUser } from "@/lib/db/queries/dashboard";
import { toPredictionDetailView } from "@/lib/view/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ userId: string; predictionId: string }>;
};

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminUserPredictionPage({ params }: PageProps) {
  const { userId, predictionId } = await params;

  // Re-check defensivo: dado privilegiado (predição + payloads de outro usuário).
  // Defense-in-depth — NÃO confiar só no gate do layout. Espelha costs/invites.
  const session = await auth();
  if (session?.user?.role !== "admin") notFound();

  // userId/predictionId são colunas uuid: params não-UUID estourariam "invalid
  // input syntax for type uuid" (500) no eq — guarda pra notFound limpo (#66).
  if (
    !z.uuid().safeParse(userId).success ||
    !z.uuid().safeParse(predictionId).success
  ) {
    notFound();
  }

  // Scoped por userId ALVO: se a predição NÃO for desse usuário → null → 404.
  // Preserva o invariante de no-cross-user-bleed mesmo no caminho de admin.
  const detail = await getPredictionDetailForUser(predictionId, userId);
  if (!detail) notFound();

  // Caminho de admin → sempre inclui os payloads brutos (input/output do LLM).
  const view = toPredictionDetailView(detail, { includeRawPayloads: true });

  return (
    <DesktopShell>
      <PredictionDetail
        view={view}
        backHref={`/admin/users/${userId}`}
        backLabel="tracking"
      />
    </DesktopShell>
  );
}
