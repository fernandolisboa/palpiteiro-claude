"use client";

import { startTransition, useEffect } from "react";

import { notePrefetchCacheCleared, shouldRevalidate } from "@/lib/nav/router-cache";
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
    const url = window.location.pathname + window.location.search;
    const revalidate = () => {
      if (shouldRevalidate(renderId, maxAgeMs, Date.now(), url)) {
        // O refresh limpa o cache do roteador inteiro, buscas por intenção incluídas.
        notePrefetchCacheCleared();
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
