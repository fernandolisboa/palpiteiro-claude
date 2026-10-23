"use client";

import Link from "next/link";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useEffect, useRef, type ComponentProps, type MouseEvent } from "react";

import { claimIntentPrefetch } from "@/lib/nav/intent-prefetch";
import { useOptionalRouter } from "@/lib/nav/use-optional-router";

// Tempo com o mouse parado em cima antes de buscar: passar o mouse por cima da lista
// rolando não dispara nada.
const HOVER_DWELL_MS = 120;

/**
 * Link do app inteiro (#639; `next/link` direto é barrado no ESLint).
 *
 * - Sem o prefetch automático do Next (`prefetch={false}` por padrão). Em página
 *   dinâmica ele guarda só o esqueleto (`loading.tsx`) numa entrada do cache do
 *   roteador, e a navegação pra essa URL busca os dados de novo TODA vez, sem guardar:
 *   bastava um link visível pra URL e reabrir a página nunca vinha do cache. Sem ele, a
 *   1ª navegação guarda a página inteira e as próximas (5 min, `staleTimes`) abrem na
 *   hora.
 * - No clique, a navegação usa uma busca completa, guardada com a query na chave
 *   (ver o `onClick`).
 * - Com o mouse parado em cima, busca a página INTEIRA antes do clique. Só com mouse
 *   de verdade (`hover: hover`): no toque o `mouseenter` emulado chega junto do clique,
 *   que já busca a página. A mesma URL não é buscada de novo por 30s
 *   (`claimIntentPrefetch`).
 */
export function IntentLink({
  prefetch = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useOptionalRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const href = typeof props.href === "string" ? props.href : null;

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // Saiu da tela (navegou) com o timer correndo: não busca mais nada.
  useEffect(() => cancel, []);

  return (
    <Link
      {...props}
      prefetch={prefetch}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        onMouseEnter?.(e);
        if (!router || !href || !window.matchMedia("(hover: hover)").matches) return;
        cancel();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (claimIntentPrefetch(href, window.location)) {
            router.prefetch(href, { kind: PrefetchKind.FULL });
          }
        }, HOVER_DWELL_MS);
      }}
      onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => {
        onMouseLeave?.(e);
        cancel();
      }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        cancel();
        onClick?.(e);
        // A navegação vai buscar a página: pede a busca completa antes (a fila do
        // roteador roda as duas em ordem, então é UMA requisição, que a navegação usa).
        // Sem isso, URL com query (`/match/x?back=…`) nunca reabre do cache: o Next 15
        // guarda a navegação sem a query na chave e, ao reabrir, só reaproveita o
        // esqueleto e busca de novo. A busca completa é guardada com a query.
        if (router && href && isPlainClick(e, props.target)) {
          router.prefetch(href, { kind: PrefetchKind.FULL });
        }
      }}
    />
  );
}

/** Clique que o `Link` transforma em navegação no app (não nova aba, não download). */
function isPlainClick(e: MouseEvent<HTMLAnchorElement>, target: unknown): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    (target === undefined || target === "_self")
  );
}
