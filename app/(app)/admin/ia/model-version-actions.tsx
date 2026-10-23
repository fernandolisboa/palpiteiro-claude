"use client";

import { useActionState, useId } from "react";

import {
  confirmModelVersionPriceAction,
  rejectModelVersionAction,
  type ModelVersionActionResult,
} from "@/app/actions/model-versions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Status({
  state,
  okText,
}: {
  state: ModelVersionActionResult | null;
  okText: string;
}) {
  // Sempre montado: leitor de tela só anuncia região viva que já existia.
  return (
    <p
      className={
        state && !state.ok
          ? "text-body-sm text-destructive"
          : "text-body-sm text-muted-foreground"
      }
      role="status"
      aria-live={state && !state.ok ? "assertive" : "polite"}
    >
      {state ? (state.ok ? okText : state.error) : ""}
    </p>
  );
}

/** Confirma o preço oficial (US$ por 1M de tokens) de uma versão adotada. */
export function ConfirmPriceForm({
  id,
  inputPricePerMTok,
  outputPricePerMTok,
}: {
  id: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}) {
  const [state, action, pending] = useActionState<
    ModelVersionActionResult | null,
    FormData
  >(confirmModelVersionPriceAction, null);
  const inputId = useId();
  const outputId = useId();

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={inputId} className="flex flex-col gap-1">
          <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
            input · US$/1M
          </span>
          <Input
            id={inputId}
            name="inputPricePerMTok"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            required
            defaultValue={inputPricePerMTok}
            className="w-28"
          />
        </label>
        <label htmlFor={outputId} className="flex flex-col gap-1">
          <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
            output · US$/1M
          </span>
          <Input
            id={outputId}
            name="outputPricePerMTok"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            required
            defaultValue={outputPricePerMTok}
            className="w-28"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Confirmar preço"}
        </Button>
      </div>
      <Status state={state} okText="Preço confirmado." />
    </form>
  );
}

/** Rejeita a versão adotada: ela vira `failed` e a família volta pra conferida. */
export function RejectVersionButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<
    ModelVersionActionResult | null,
    FormData
  >(rejectModelVersionAction, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Rejeitando…" : "Rejeitar esta versão"}
      </Button>
      <Status state={state} okText="Rejeitada. A família volta pra conferida." />
    </form>
  );
}
