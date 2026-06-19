"use client";

import { useActionState } from "react";
import { Dices, Loader2 } from "lucide-react";

import { regeneratePalpitesAction, type RegenResult } from "@/app/actions/palpites";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

// Copy do erro por ramo da union (PLAN §4/§5): rate = teto explícito; o resto
// (not_found/generation_error) colapsa numa mensagem genérica (não vaza detalhe).
function errorMessage(error: Extract<RegenResult, { ok: false }>["error"]): string {
  if (error === "rate") return "limite atingido, tente mais tarde";
  return "não consegui gerar agora";
}

// Estado inicial da action (PLAN §5): null = nunca disparada (sem erro, sem sucesso).
type State = RegenResult | null;

/**
 * Botão "gerar novos palpites" — o ÚNICO "use client" do painel (PLAN §4). Liga
 * regeneratePalpitesAction via useActionState: pending → spinner + disabled (os
 * cards atuais FICAM visíveis, regen é otimista/não-bloqueante); sucesso →
 * revalidatePath troca o set no próximo render (nenhuma UI extra aqui); erro → a
 * union {ok:false} vira um Callout warn DISCRETO inline (nunca full-bleed).
 *
 * `label` permite "gerar palpites" (estado empty) vs "gerar novos palpites"
 * (populated) sem duplicar a fiação da action.
 */
export function RegenButton({
  matchId,
  label = "gerar novos palpites",
}: {
  matchId: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    () => regeneratePalpitesAction(matchId),
    null,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Dices className="size-3.5" aria-hidden />
          )}
          {pending ? "gerando…" : label}
        </Button>
      </form>
      {state && !state.ok && (
        <Callout variant="warn" className="px-3 py-2">
          <span className="text-body-sm tracking-tight text-muted-foreground">
            {errorMessage(state.error)}
          </span>
        </Callout>
      )}
    </div>
  );
}
