import { ChevronLeft } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";

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

function OddsSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 py-3.5">
        <Skeleton className="h-[14px] w-32" />
        <Skeleton className="h-[12px] w-20" />
      </div>
      <div className="grid grid-cols-2 border-t border-border-subtle">
        <div className="flex flex-col gap-2 border-r border-border-subtle px-4 py-3.5">
          <Skeleton className="h-[12px] w-16" />
          <Skeleton className="h-[22px] w-12" />
          <Skeleton className="h-[11px] w-20" />
        </div>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <Skeleton className="h-[12px] w-16" />
          <Skeleton className="h-[22px] w-12" />
          <Skeleton className="h-[11px] w-20" />
        </div>
      </div>
    </Card>
  );
}

// Um esqueleto só (#576), na ordem da página: barra, hero, palpite, odds e dados. Sem
// árvores por largura: o `lg:` fica dentro de cada bloco, como na página.
export default function MatchLoading() {
  return (
    <PageContainer width="content">
      <HeaderBar />
      <HeroSkeleton />
      <div className="flex flex-col gap-4 pt-4 lg:gap-6">
        <Skeleton className="h-72 w-full rounded-xl lg:h-56" />
        <div className="grid gap-3 lg:grid-cols-2">
          <OddsSkeleton />
          <OddsSkeleton />
        </div>
        <div className="flex flex-col gap-3">
          <MatchSectionsSkeleton />
          <MatchAuxiliarySkeleton />
        </div>
      </div>
    </PageContainer>
  );
}
