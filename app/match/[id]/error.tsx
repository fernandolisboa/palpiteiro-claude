"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { ChevronLeft, RefreshCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

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
          href="/jogos"
          className="flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-body-sm tracking-tight">jogos</span>
        </Link>
      </header>
      <div className="mx-auto w-full max-w-narrow px-5 pt-6">
        <Callout
          variant="warn"
          icon={<TriangleAlert className="size-4" />}
          title="Falha ao carregar o jogo"
        >
          <span className="text-body-sm text-muted-foreground tracking-tight">
            {error.message || "Erro inesperado."}
          </span>
          {error.digest && (
            <span className="font-mono text-eyebrow text-muted-fg-2">
              trace · {error.digest}
            </span>
          )}
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => reset()}>
              <RefreshCcw className="size-3.5" /> Tentar novamente
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/jogos">Voltar para a lista</Link>
            </Button>
          </div>
        </Callout>
      </div>
    </main>
  );
}
