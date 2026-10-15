"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

// "Atualizar placar" do cabeçalho do jogo ao vivo (#580, PLAN-580 §13). Sem polling
// (pergunta 3 do plano): o placar só é relido quando a pessoa toca no botão ou volta pra
// aba. Cada refresh re-renderiza a página no servidor, que respeita o cache de 1 min do
// estado (match_live_states): tocar várias vezes não gasta a cota da API-Football.
export function LiveScoreRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        startTransition(() => router.refresh());
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCcw className="size-3" aria-hidden />
      {pending ? "Atualizando…" : "Atualizar placar"}
    </Button>
  );
}
