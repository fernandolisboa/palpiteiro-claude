import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

// Mesmo desenho da página (#577): resumo em três cartões, gráfico, a faixa do
// "Detalhe técnico" fechado e a tabela.
export default function DashboardLoading() {
  return (
    <>
      <PageContainer width="content">
        <PageHeaderSkeleton title="Desempenho" description />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-[260px] rounded-xl" />
        <Skeleton className="mt-8 h-12 rounded-xl" />
        <Skeleton className="mt-8 h-[340px] rounded-xl" />
      </PageContainer>
    </>
  );
}
