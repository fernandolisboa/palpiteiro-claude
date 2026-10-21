"use client";

import { useBetSlip } from "@/components/bet-slip/bet-slip-provider";
import { Button } from "@/components/ui/button";

// "Explicar com IA" (#562, ADR 0063) sob a avaliação recém-registrada. Só os ids vão
// pro servidor; o estado mora no provider (os dois painéis mostram o mesmo) e só vale
// pros slips DESTE registro: um registro novo esconde a explicação antiga.

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function SlipExplain({ slipIds }: { slipIds: string[] }) {
  const slip = useBetSlip();
  if (!slip) return null;
  const state =
    slip.explainState && sameIds(slip.explainState.slipIds, slipIds)
      ? slip.explainState
      : null;

  if (state?.ok) {
    const { explanation } = state;
    return (
      <div className="flex flex-col gap-3 px-4 pb-3" aria-live="polite">
        <span className="text-meta tracking-eyebrow text-muted-foreground uppercase">
          explicação com IA
        </span>
        <p className="text-body-sm text-foreground leading-relaxed tracking-tight">
          {explanation.summary}
        </p>
        {explanation.legs.map((leg, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-body-sm text-foreground font-medium tracking-tight">
              {leg.label}
            </span>
            <p className="text-body-sm text-foreground leading-relaxed tracking-tight">
              {leg.text}
            </p>
          </div>
        ))}
        {explanation.combo && (
          <div className="flex flex-col gap-1">
            <span className="text-body-sm text-foreground font-medium tracking-tight">
              Combinada (todas juntas)
            </span>
            <p className="text-body-sm text-foreground leading-relaxed tracking-tight">
              {explanation.combo}
            </p>
          </div>
        )}
        <p className="text-meta text-muted-foreground leading-relaxed tracking-tight">
          {explanation.note}
        </p>
      </div>
    );
  }

  return (
    <form
      action={slip.explainAction}
      className="flex flex-col gap-1.5 px-4 pb-3"
    >
      <input type="hidden" name="slipIds" value={JSON.stringify(slipIds)} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={slip.explaining}
      >
        {slip.explaining ? "Explicando…" : "Explicar com IA"}
      </Button>
      <span className="text-meta text-muted-foreground leading-relaxed tracking-tight">
        A IA explica o porquê dos números acima, sem mudar nenhum. Conta 1 do
        seu limite diário de palpites.
      </span>
      {state && !state.ok && (
        <p
          className="text-body-sm text-destructive tracking-tight"
          role="alert"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
