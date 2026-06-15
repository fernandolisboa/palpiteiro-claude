"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isNewVersionAvailable } from "@/lib/version/compare";

// Leitura DIRETA de `process.env.NEXT_PUBLIC_*` (membro literal) — o Next só
// inlina assim no bundle cliente; destructuring/chave computada NÃO inlina e
// `loaded` viraria undefined (banner nunca dispara). Mapeada de
// VERCEL_GIT_COMMIT_SHA em next.config.ts (env), fallback "dev" em local.
const LOADED_SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

const POLL_INTERVAL_MS = 60_000;

/**
 * Detecta um deploy novo comparando o SHA assado no bundle (carregado) com o da
 * /api/version (vivo). Polla em intervalo + em visibilitychange/focus/pageshow
 * (este cobre o bfcache do Safari, que serve página stale ao reabrir aba/voltar)
 * e mostra um banner DISMISSÍVEL com ação explícita de reload — sem auto-reload,
 * pra não descartar form meio preenchido (ADR 0024, #260). Dispensar silencia
 * APENAS aquele SHA: um deploy posterior re-arma o banner.
 *
 * Em dev local (LOADED_SHA ausente/"dev") é no-op: nem polla nem renderiza.
 */
export function VersionChecker() {
  // SHA do servidor que justifica o banner atual (null = nenhum).
  const [serverSha, setServerSha] = useState<string | null>(null);
  // SHA que o usuário dispensou. O banner reaparece se um deploy AINDA mais novo
  // (serverSha !== dismissedSha) chegar — dismiss não silencia deploys futuros.
  const [dismissedSha, setDismissedSha] = useState<string | null>(null);
  // Guarda de in-flight: rajadas de visibilitychange/focus não martelam a rota.
  const inFlight = useRef(false);

  // No-op em dev local: nenhum hook abaixo registra polling/listeners. O early
  // return fica DEPOIS dos hooks de estado (regra dos hooks), mas o efeito só é
  // armado quando há SHA real — então em dev não há fetch nem interval.
  const isActive = Boolean(LOADED_SHA) && LOADED_SHA !== "dev";

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    async function check() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const sha =
          typeof data === "object" &&
          data !== null &&
          "sha" in data &&
          typeof (data as { sha: unknown }).sha === "string"
            ? (data as { sha: string }).sha
            : null;
        if (!cancelled && isNewVersionAvailable(LOADED_SHA, sha)) {
          setServerSha(sha);
        }
      } catch {
        // Poll com falha (offline, etc.) nunca pode derrubar o shell — engole.
      } finally {
        inFlight.current = false;
      }
    }

    function checkIfVisible() {
      if (document.visibilityState === "visible") void check();
    }

    function onPageShow(event: PageTransitionEvent) {
      // bfcache (Safari) restaura uma página possivelmente stale → revalida.
      if (event.persisted) void check();
    }

    const interval = setInterval(checkIfVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", checkIfVisible);
    window.addEventListener("focus", checkIfVisible);
    window.addEventListener("pageshow", onPageShow);

    void check();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkIfVisible);
      window.removeEventListener("focus", checkIfVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isActive]);

  // Mostra o banner quando há um SHA novo do servidor que o usuário ainda não
  // dispensou. Um deploy posterior (serverSha diferente do dismissedSha) re-arma.
  if (!isActive || !serverSha || serverSha === dismissedSha) return null;

  return (
    // z-40 fica ABAIXO do Sheet/Dialog do shadcn (z-50) — não prende o drawer da
    // MobileNav aberto. Barra ancorada na base, largura limitada e centralizada
    // (não é overlay full-bleed) pra não bloquear navegação. Polish visual fica
    // pra um passo /impeccable posterior (#260).
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg">
        <span>Nova versão disponível.</span>
        <Button
          variant="default"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="size-4" />
          Recarregar
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dispensar aviso de nova versão"
          onClick={() => setDismissedSha(serverSha)}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
