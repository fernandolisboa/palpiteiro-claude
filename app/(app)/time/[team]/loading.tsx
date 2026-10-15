import { Card } from "@/components/ui/card";
import { PageContainer } from "@/components/page-container";
import { PageHeaderSkeleton } from "@/components/page-header";
import { MatchRowSkeleton } from "@/components/match-row";
import { SectionLabel } from "@/components/section-label";

// Casa a forma de cada MatchRow (anti-CLS): o mesmo esqueleto da linha da lista.
function ListSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <MatchRowSkeleton />
      <MatchRowSkeleton />
      <MatchRowSkeleton last />
    </Card>
  );
}

export default function TeamHistoryLoading() {
  return (
    <>
      <div className="lg:hidden">
        <div className="bg-background text-foreground">
          <div className="px-5 pt-6">
            <PageHeaderSkeleton back meta className="pb-2" />
          </div>
          <div className="flex flex-col gap-2 pb-8">
            <SectionLabel>próximos jogos</SectionLabel>
            <div className="px-5">
              <ListSkeleton />
            </div>
            <div className="pt-3">
              <SectionLabel>últimos resultados</SectionLabel>
            </div>
            <div className="px-5">
              <ListSkeleton />
            </div>
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <>
          <PageContainer width="content">
            <PageHeaderSkeleton back meta />
            <div className="grid grid-cols-2 gap-8">
              <section className="flex flex-col gap-2">
                <SectionLabel>próximos jogos</SectionLabel>
                <ListSkeleton />
              </section>
              <section className="flex flex-col gap-2">
                <SectionLabel>últimos resultados</SectionLabel>
                <ListSkeleton />
              </section>
            </div>
          </PageContainer>
        </>
      </div>
    </>
  );
}
