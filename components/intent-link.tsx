"use client";

import Link from "next/link";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import {
  startTransition,
  useEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
} from "react";

import { claimIntentPrefetch } from "@/lib/nav/intent-prefetch";
import { notePrefetch, notePrefetchCacheCleared, urlKey } from "@/lib/nav/router-cache";
import { useOptionalRouter } from "@/lib/nav/use-optional-router";

// Tempo com o mouse parado em cima antes de buscar: passar o mouse por cima da lista
// rolando não dispara nada.
const HOVER_DWELL_MS = 120;

type Props = ComponentProps<typeof Link>;

/**
 * Link do app inteiro (#639, ADR 0067; `next/link` direto é barrado no ESLint).
 *
 * - Sem o prefetch automático do Next (`prefetch={false}` por padrão). Em página
 *   dinâmica ele guarda só o esqueleto (`loading.tsx`) na entrada da URL, e a navegação
 *   pra essa URL busca os dados de novo TODA vez, sem guardar: bastava um link visível
 *   pra URL e reabrir a página nunca vinha do cache. Sem ele, a 1ª navegação guarda a
 *   página inteira e as próximas (5 min, `staleTimes`) abrem na hora.
 * - URL com query (`/match/x?back=…`): o clique pede a busca completa antes de navegar
 *   (ver o `onClick`).
 * - Com o mouse parado em cima, busca a página INTEIRA antes do clique. Só com mouse
 *   de verdade (`hover: hover`): no toque o `mouseenter` emulado chega junto do clique,
 *   que já busca a página. A mesma URL não é buscada de novo por 30s
 *   (`claimIntentPrefetch`). A hora da busca fica anotada pro `RevisitRefresh` contar a
 *   idade da página a partir dela.
 * - Clique no link da página em que já se está relê a página (antes do cache, o Next
 *   buscava de novo; agora reaproveitaria a guardada sem fazer nada).
 */
export function IntentLink({
  prefetch = false,
  onMouseEnter,
  onMouseLeave,
  onClick,
  ...props
}: Props) {
  const router = useOptionalRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const href = typeof props.href === "string" ? props.href : null;
  const inApp = href !== null && opensInPlace(props);

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
        if (!router || !href || !inApp || !window.matchMedia("(hover: hover)").matches) {
          return;
        }
        if (new URL(href, window.location.href).origin !== window.location.origin) return;
        cancel();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (claimIntentPrefetch(href, window.location)) {
            notePrefetch(urlKey(href, window.location.href));
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
        if (!router || !href || !inApp || !isPlainClick(e)) return;
        const target = new URL(href, window.location.href);
        if (target.origin !== window.location.origin) return;
        const key = target.pathname + target.search;
        if (key === window.location.pathname + window.location.search) {
          // Âncora na mesma página: só rola.
          if (target.hash) return;
          notePrefetchCacheCleared();
          startTransition(() => router.refresh());
          return;
        }
        // O Next 15 guarda a navegação SEM a query na chave: ao reabrir uma URL com
        // query, só reaproveita o esqueleto e busca de novo. A busca completa é guardada
        // com a query, e a navegação logo em seguida usa a mesma requisição. Só pra URL
        // com query: a busca completa sai com prioridade baixa na rede, a navegação
        // comum com prioridade alta.
        if (target.search) {
          notePrefetch(key);
          router.prefetch(href, { kind: PrefetchKind.FULL });
        }
      }}
    />
  );
}

/** Abre na própria aba, como navegação do app (não nova aba nem download). */
function opensInPlace(props: Omit<Props, "prefetch" | "onMouseEnter" | "onMouseLeave" | "onClick">): boolean {
  return (
    (props.target === undefined || props.target === "_self") &&
    (props.download === undefined || props.download === false)
  );
}

/** Clique que o `Link` transforma em navegação (sem tecla de nova aba/janela). */
function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}
