"use client";

import { useActionState } from "react";

import {
  overridePredictionOutcome,
  type OverrideResult,
} from "@/app/actions/settlement";

// Opções selecionáveis no override. Subconjunto explícito do OutcomeResult
// (mesma união desde #168, que adicionou push). A action valida result_data por
// contrato e a regra "sem odd → só void" (que cobre push) no boundary.
const OVERRIDE_RESULTS = ["won", "lost", "void", "push"] as const;
type OverrideResultOption = (typeof OVERRIDE_RESULTS)[number];

type Props = {
  predictionId: string;
  defaultResult: OverrideResultOption;
};

const RESULT_LABEL: Record<OverrideResultOption, string> = {
  won: "Ganha (won)",
  lost: "Perdida (lost)",
  void: "Anulada (void)",
  push: "Push (devolve stake)",
};

export function OverrideForm({ predictionId, defaultResult }: Props) {
  const [state, action, pending] = useActionState<
    OverrideResult | null,
    FormData
  >(overridePredictionOutcome, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="predictionId" value={predictionId} />

      <div className="flex gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            gols casa (90&apos;)
          </span>
          <input
            type="number"
            name="homeScore"
            min={0}
            required
            className="w-24 rounded-md border border-border bg-transparent px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            gols visit. (90&apos;)
          </span>
          <input
            type="number"
            name="awayScore"
            min={0}
            required
            className="w-24 rounded-md border border-border bg-transparent px-3 py-2 text-sm tabular-nums"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          resultado
        </span>
        <select
          name="result"
          defaultValue={defaultResult}
          className="w-56 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          {OVERRIDE_RESULTS.map((r) => (
            <option key={r} value={r}>
              {RESULT_LABEL[r]}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[12px] text-muted-foreground">
        O profit é recalculado a partir do resultado + odd de entrada + stake da
        predição. &quot;void&quot; e &quot;push&quot; zeram o profit (push devolve
        o stake). Predição sem odd só pode ser anulada (void).
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar override"}
      </button>

      {state &&
        (state.ok ? (
          <p className="text-[13px] text-accent-fg">Override salvo.</p>
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
