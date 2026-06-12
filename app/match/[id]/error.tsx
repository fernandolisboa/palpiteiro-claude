"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { ChevronLeft, RefreshCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function MatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>
      </header>
      <div className="mx-auto w-full max-w-[480px] px-5 pt-6">
        <Card className="border-warn-border bg-card">
          <div className="flex items-start gap-3 px-5 py-5">
            <span className="pt-0.5 text-warn-fg">
              <TriangleAlert className="size-4" />
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <span className="text-[14px] font-medium tracking-tight">
                Falha ao carregar o jogo
              </span>
              <span className="text-[12.5px] text-muted-foreground tracking-tight">
                {error.message || "Erro inesperado."}
              </span>
              {error.digest && (
                <span className="font-mono text-[10.5px] text-muted-fg-2">
                  trace · {error.digest}
                </span>
              )}
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => reset()}>
                  <RefreshCcw className="size-3.5" /> Tentar novamente
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/">Voltar para a lista</Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
