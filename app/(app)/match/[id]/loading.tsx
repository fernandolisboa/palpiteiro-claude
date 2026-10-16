import { ChevronLeft } from "lucide-react";

import { MarketTableSkeleton } from "@/components/bet-slip/market-table-section";
import { PageContainer } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";

function HeaderBar() {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">
        <ChevronLeft className="size-3.5" />
        <span className="text-body-sm tracking-tight">jogos</span>
      </span>
      <Skeleton className="h-4 w-24" />
    </div>
  );
}

// Responsivo igual ao MatchHero unificado (#246): mobile grid 3-col, desktop flex —
// pra o skeleton casar com o conteúdo nos dois viewports (anti-CLS). O gutter é do
// PageContainer (#576).
function HeroSkeleton() {
  return (
    <div className="pt-4 pb-2 lg:pt-6">
      <div className="flex items-center justify-between pb-4 lg:justify-start lg:gap-3 lg:pb-5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-[14px] w-24" />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 lg:flex lg:items-center lg:gap-8">
        <div className="flex flex-col items-center gap-2.5 lg:flex-row lg:gap-3">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-[14px] w-24" />
        </div>
        <Skeleton className="h-[26px] w-10 lg:h-[30px]" />
        <div className="flex flex-col items-center gap-2.5 lg:flex-row lg:gap-3">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-[14px] w-24" />
        </div>
      </div>
    </div>
  );
}

// Barra de abas (Mercados / Seu palpite / Dados) no lugar e na altura da tablist.
function TabsSkeleton() {
  return (
    <div className="py-2">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="h-9" />
        <div className="h-9" />
      </div>
    </div>
  );
}

// Um esqueleto só (#576), na ordem da página: barra, hero, palpite, abas e a tabela de
// mercados (a aba padrão). Sem árvores por largura: no `lg:` a grade já reserva a coluna
// de 340px do painel Suas apostas, então a coluna principal nasce na largura final. Por
// isso é sempre `wide`: a página só cai pra `content` sem o painel (jogo encerrado ou
// sem registro), caso em que o esqueleto já não casava antes.
export default function MatchLoading() {
  return (
    <PageContainer width="wide">
      <HeaderBar />
      <HeroSkeleton />
      <div className="pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <Skeleton className="h-72 w-full rounded-xl lg:h-56" />
          <div className="flex flex-col gap-4">
            <TabsSkeleton />
            <MarketTableSkeleton />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
