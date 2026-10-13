"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

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
    // key = valor persistido: o React 19 reseta o <form> depois de uma action e
    // volta os campos não controlados pro defaultValue da MONTAGEM (o do select não
    // acompanha o prop). Remontar quando o servidor devolve o valor novo faz o reset
    // cair no valor salvo em vez do antigo.
    <form key={defaultResult} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="predictionId" value={predictionId} />

      <div className="flex gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            gols casa (90&apos;)
          </span>
          <input
            type="number"
            name="homeScore"
            min={0}
            required
            className="w-24 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            gols visit. (90&apos;)
          </span>
          <input
            type="number"
            name="awayScore"
            min={0}
            required
            className="w-24 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          resultado
        </span>
        <div className="max-w-aside">
          <Select name="result" defaultValue={defaultResult}>
            {OVERRIDE_RESULTS.map((r) => (
              <option key={r} value={r}>
                {RESULT_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
      </label>

      <p className="text-body-sm text-muted-foreground">
        O profit é recalculado a partir do resultado + odd de entrada + stake da
        predição. &quot;void&quot; e &quot;push&quot; zeram o profit (push devolve
        o stake). Predição sem odd só pode ser anulada (void).
      </p>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar override"}
      </Button>

      {state &&
        (state.ok ? (
          <p className="text-body text-edge-fg" role="status" aria-live="polite">
            Override salvo.
          </p>
        ) : (
          <p
            className="text-body text-destructive"
            role="alert"
            aria-live="assertive"
          >
            {state.error}
          </p>
        ))}
    </form>
  );
}
