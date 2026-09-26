"use client";

import { useActionState } from "react";

import {
  refitTeamRatingsNow,
  type RefitTeamRatingsResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";

/** Dispara o refit do Dixon-Coles na hora (o mesmo job do cron diário, ADR 0051). */
export function RefitRatingsButton() {
  const [state, action, pending] = useActionState<
    RefitTeamRatingsResult | null,
    FormData
  >(refitTeamRatingsNow, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Reajustando…" : "Reajustar agora"}
      </Button>
      {state && (
        <p
          className={
            state.ok
              ? "text-body-sm text-muted-foreground"
              : "text-body-sm text-destructive"
          }
          role={state.ok ? "status" : "alert"}
        >
          {state.ok
            ? `${state.fitted} liga(s) ajustada(s)${state.skipped ? `, ${state.skipped} mantida(s) no ajuste anterior` : ""}.`
            : state.error}
        </p>
      )}
    </form>
  );
}
