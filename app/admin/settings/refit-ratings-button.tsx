"use client";

import { useActionState } from "react";

import {
  refitTeamRatingsNow,
  type RefitTeamRatingsResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";

function describe(state: RefitTeamRatingsResult): {
  text: string;
  error: boolean;
} {
  if (!state.ok) return { text: state.error, error: true };
  const parts = [`${state.fitted} liga(s) ajustada(s)`];
  if (state.tooFew) parts.push(`${state.tooFew} sem jogos suficientes`);
  if (state.failed.length) {
    const names = state.failed.map((l) => LEAGUE_LABEL[leagueToKey(l)]);
    parts.push(`falhou em ${names.join(", ")} (mantém o ajuste anterior)`);
  }
  return { text: `${parts.join(", ")}.`, error: state.failed.length > 0 };
}

/** Dispara o refit do Dixon-Coles na hora (o mesmo job do cron diário, ADR 0051). */
export function RefitRatingsButton() {
  const [state, action, pending] = useActionState<
    RefitTeamRatingsResult | null,
    FormData
  >(refitTeamRatingsNow, null);
  const message = state ? describe(state) : null;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button
        type="submit"
        size="sm"
        variant="outline"
        aria-disabled={pending}
        aria-busy={pending}
        onClick={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        {pending ? "Reajustando…" : "Reajustar agora"}
      </Button>
      {/* Sempre montado: leitor de tela só anuncia região viva que já existia. */}
      <p
        className={
          message?.error
            ? "text-body-sm text-destructive"
            : "text-body-sm text-muted-foreground"
        }
        role="status"
        aria-live={message?.error ? "assertive" : "polite"}
      >
        {message?.text ?? ""}
      </p>
    </form>
  );
}
