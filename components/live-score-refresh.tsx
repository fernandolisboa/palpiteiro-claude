"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

// "Atualizar placar" do cabeçalho do jogo ao vivo (#580, PLAN-580 §13). Sem polling
// (pergunta 3 do plano): o placar só é relido quando a pessoa toca no botão, volta pra
// aba ou reabre a página (esses dois pelo `RevisitRefresh live` da página, #639). Cada
// refresh re-renderiza a página no servidor, que respeita o cache de 1 min do estado
// (match_live_states): tocar várias vezes não gasta a cota da API-Football.
export function LiveScoreRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      // Alvo de toque de 44px no celular (min-h-11, como as células da tabela de
      // mercados); no desktop volta ao tamanho xs.
      className="min-h-11 text-muted-foreground lg:min-h-0"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCcw className="size-3" aria-hidden />
      {pending ? "Atualizando…" : "Atualizar placar"}
    </Button>
  );
}
