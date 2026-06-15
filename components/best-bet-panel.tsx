"use client";

import { useActionState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { analyzeBestBet } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { BestBetResults } from "@/components/best-bet-results";
import { Button } from "@/components/ui/button";

export function BestBetPanel({ matchId }: { matchId: string }) {
  const [state, formAction, pending] = useActionState(analyzeBestBet, null);

  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-3">
      <input type="hidden" name="matchId" value={matchId} />
      {state?.ok ? (
        <>
          <BestBetResults view={state.view} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending}
            className="self-start"
          >
            {pending ? "Reanalisando…" : "Analisar todos de novo"}
          </Button>
        </>
      ) : pending ? (
        <CTAButton pending />
      ) : state && !state.ok ? (
        <AnalysisErrorCard error={state.error} />
      ) : (
        <CTAButton pending={false} />
      )}
    </form>
  );
}

function CTAButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={pending} className="self-start">
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Sparkles className="size-4" />
      )}
      {pending ? "Analisando todos os mercados…" : "Analisar todos os mercados"}
    </Button>
  );
}
