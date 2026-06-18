import { ChevronLeft } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopShell } from "@/components/desktop-shell";
import {
  MatchAuxiliarySkeleton,
  MatchSectionsSkeleton,
} from "@/components/skeletons/match-sections-skeleton";

function HeaderBar() {
  return (
    <header className="flex items-center justify-between px-5 pt-5 pb-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        <ChevronLeft className="size-3.5" />
        <span className="text-body-sm tracking-tight">jogos</span>
      </span>
      <Skeleton className="h-4 w-24" />
    </header>
  );
}

// Responsivo igual ao MatchHero unificado (#246): mobile grid 3-col, desktop flex —
// pra o skeleton casar com o conteúdo nos dois viewports (anti-CLS).
function HeroSkeleton() {
  return (
    <div className="px-5 pt-5 pb-5 lg:px-0 lg:pt-0 lg:pb-0">
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

export default function MatchLoading() {
  return (
    <>
      <div className="lg:hidden">
        <div className="min-h-screen bg-background text-foreground">
          <HeaderBar />
          <HeroSkeleton />
          <div className="flex flex-col gap-3 px-5 pb-6">
            <OddsSkeleton />
            <Skeleton className="h-12 w-full rounded-md" />
            <MatchSectionsSkeleton />
            <MatchAuxiliarySkeleton />
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <DesktopShell>
          <div className="mx-auto w-full max-w-content px-8 pt-8 pb-16">
            <div className="grid grid-cols-[1fr_320px] gap-8 pb-8">
              <HeroSkeleton />
              <OddsSkeleton />
            </div>
            <Skeleton className="mb-6 h-12 w-48 rounded-md" />
            <MatchSectionsSkeleton />
            <MatchAuxiliarySkeleton />
          </div>
        </DesktopShell>
      </div>
    </>
  );
}
