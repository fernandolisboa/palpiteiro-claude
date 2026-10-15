import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de cold-start do detalhe de predição (admin) (#324). Espelha
 * `app/dashboard/[predictionId]/loading.tsx` — a página delega 100% pro
 * `PredictionDetail` sob `max-w-reading`. Loading próprio (não a
 * cascata do `[userId]`) pra casar a largura de leitura e evitar CLS.
 */
export default function AdminPredictionDetailLoading() {
  return (
    <>
      <PageContainer width="reading">
        <PageHeaderSkeleton back meta className="pb-2 lg:pb-2" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </PageContainer>
    </>
  );
}
