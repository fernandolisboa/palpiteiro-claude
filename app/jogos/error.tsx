"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { RefreshCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/page-header";

export default function GlobalError({
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
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader subtitle="erro" />
      <div className="mx-auto w-full max-w-narrow px-5 pt-8">
        <Callout
          variant="warn"
          icon={<TriangleAlert className="size-4" />}
          title="Falha ao carregar jogos"
        >
          <span className="text-body-sm text-muted-foreground tracking-tight">
            {error.message || "Erro inesperado ao buscar dados."}
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
    </div>
  );
}
