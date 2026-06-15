import { notFound, redirect } from "next/navigation";

import { PredictionDetail } from "@/components/dashboard/prediction-detail";
import { DesktopShell } from "@/components/desktop-shell";
import { auth } from "@/auth";
import { getClosingSnapshotForDetail } from "@/lib/db/queries/clv-snapshots";
import { getPredictionDetailForUser } from "@/lib/db/queries/dashboard";
import { toPredictionDetailView } from "@/lib/view/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ predictionId: string }>;
};

export default async function PredictionDetailPage({ params }: PageProps) {
  const { predictionId } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Scoped por userId: predição de outro usuário → null → 404.
  const detail = await getPredictionDetailForUser(predictionId, session.user.id);
  if (!detail) notFound();

  // CLV (#180): closing line da seleção escolhida (null em pass / sem marketId /
  // sem captura perto do KO → CLV "—" na view).
  const closing = await getClosingSnapshotForDetail(detail.prediction);

  // Gate explícito: só admin vê os payloads brutos (protege o system prompt).
  // NÃO confiar no middleware pra isso — o check é aqui, no servidor.
  const isAdmin = session.user.role === "admin";
  const view = toPredictionDetailView(detail, {
    includeRawPayloads: isAdmin,
    closing,
  });

  return (
    <DesktopShell>
      <PredictionDetail view={view} />
    </DesktopShell>
  );
}
