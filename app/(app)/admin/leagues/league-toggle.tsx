"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

import { toggleLeague, type ToggleLeagueResult } from "./actions";

type Props = {
  league: SupportedLeague;
  label: string;
  active: boolean;
};

/** Botão de ligar/desligar uma liga no /admin/leagues (Server Action). */
export function LeagueToggle({ league, label, active }: Props) {
  const [state, action, pending] = useActionState<
    ToggleLeagueResult | null,
    FormData
  >(toggleLeague, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="league" value={league} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Button
        type="submit"
        size="sm"
        variant={active ? "outline" : "default"}
        disabled={pending}
        aria-label={`${active ? "Desligar" : "Ligar"} ${label}`}
      >
        {pending ? "Salvando…" : active ? "Desligar" : "Ligar"}
      </Button>
      {state && !state.ok && (
        <p
          className="max-w-aside text-body-sm text-destructive text-right"
          role="alert"
          aria-live="assertive"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
