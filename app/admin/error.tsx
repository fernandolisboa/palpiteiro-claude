"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Boundary de erro compartilhado do subtree `/admin` (#324). Espelha
 * `app/dashboard/error.tsx`: cobre todas as rotas admin (incl. as DesktopShell),
 * renderiza bare. Reporta ao Sentry e oferece retry + volta pro painel.
 */
export default function AdminError({
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
      <div className="mx-auto flex max-w-narrow flex-col items-center gap-4 px-6 py-24 text-center">
        <span className="text-warn-fg">
          <TriangleAlert className="size-9" strokeWidth={1.25} />
        </span>
        <h1 className="text-display-sm font-medium tracking-tight">
          Falha ao carregar o admin
        </h1>
        <p className="text-body text-muted-foreground">
          Tente novamente em instantes.
          {error.digest ? (
            <span className="block pt-1 font-mono text-meta text-muted-fg-2">
              {error.digest}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={reset} size="sm">
            Tentar novamente
          </Button>
          <Link
            href="/admin"
            className="rounded-sm text-body text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Admin
          </Link>
        </div>
      </div>
    </div>
  );
}
