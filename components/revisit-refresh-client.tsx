"use client";

import { startTransition, useEffect } from "react";

import { shouldRevalidate } from "@/lib/nav/router-cache";
import { useOptionalRouter } from "@/lib/nav/use-optional-router";

/**
 * Lado do navegador do `RevisitRefresh`: página reaberta do cache com idade (ou de
 * volta à aba depois de um tempo) → `router.refresh()` numa transição. A tela fica como
 * está até o servidor responder e só as partes que mudaram trocam; estado local
 * (formulário digitado, aba aberta) é preservado.
 */
export function RevisitRefreshClient({
  renderId,
  maxAgeMs,
}: {
  renderId: string;
  maxAgeMs: number;
}) {
  const router = useOptionalRouter();

  useEffect(() => {
    if (!router) return;
    const revalidate = () => {
      if (shouldRevalidate(renderId, maxAgeMs)) {
        startTransition(() => router.refresh());
      }
    };
    revalidate();
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [renderId, maxAgeMs, router]);

  return null;
}
