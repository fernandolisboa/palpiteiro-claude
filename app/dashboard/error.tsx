"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 px-6 py-24 text-center">
        <span className="text-amber-500">
          <TriangleAlert className="size-9" strokeWidth={1.25} />
        </span>
        <h1 className="text-[18px] font-medium tracking-tight">
          Falha ao carregar o dashboard
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Tente novamente em instantes.
          {error.digest ? (
            <span className="block pt-1 font-mono text-[11px] text-muted-fg-2">
              {error.digest}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={reset} size="sm">
            Tentar novamente
          </Button>
          <Link
            href="/"
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            Início
          </Link>
        </div>
      </div>
    </div>
  );
}
