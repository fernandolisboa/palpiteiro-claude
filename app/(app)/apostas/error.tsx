"use client";

import * as Sentry from "@sentry/nextjs";
import { IntentLink } from "@/components/intent-link";
import { RefreshCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

export default function ApostasError({
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
    <div className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-narrow px-5 pt-8">
        <Callout
          variant="warn"
          icon={<TriangleAlert className="size-4" />}
          title="Falha ao carregar suas apostas"
        >
          <span className="text-body-sm text-muted-foreground tracking-tight">
            {error.message || "Erro inesperado ao buscar dados."}
          </span>
          {error.digest && (
            <code className="font-mono text-meta text-muted-foreground">
              trace · {error.digest}
            </code>
          )}
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => reset()}>
              <RefreshCcw className="size-3.5" /> Tentar novamente
            </Button>
            <Button asChild size="sm" variant="ghost">
              <IntentLink href="/jogos">Voltar pros jogos</IntentLink>
            </Button>
          </div>
        </Callout>
      </div>
    </div>
  );
}
