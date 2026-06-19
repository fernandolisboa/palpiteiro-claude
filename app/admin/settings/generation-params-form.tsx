"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useId, useState } from "react";

import {
  updateGenerationParams,
  type UpdateGenerationParamsResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  EFFORT_LEVELS,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  type GenerationParams,
} from "@/lib/ai/generation-params";

type Props = {
  current: GenerationParams;
};

// Parâmetros sensíveis (ADR 0008, emenda 2): afetam custo/qualidade/latência de
// TODA análise. Por isso os campos começam DESABILITADOS e só liberam via toggle
// explícito, com aviso destacado. A server action revalida role admin + ranges.
export function GenerationParamsForm({ current }: Props) {
  const [state, action, pending] = useActionState<
    UpdateGenerationParamsResult | null,
    FormData
  >(updateGenerationParams, null);
  const [enabled, setEnabled] = useState(false);
  const toggleId = useId();

  return (
    <form action={action} className="flex flex-col gap-4">
      <div
        role="note"
        className="rounded-md border border-warn-border bg-warn-soft px-4 py-3 text-body-sm text-warn-fg"
      >
        <p className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="size-4" aria-hidden="true" />
          Parâmetros sensíveis
        </p>
        <p className="mt-1 text-warn-fg">
          Estes valores afetam custo, qualidade e latência de{" "}
          <strong>toda análise</strong>, para todos os usuários. Os campos
          começam bloqueados — habilite a edição abaixo só se souber o que está
          fazendo.
        </p>
      </div>

      <label htmlFor={toggleId} className="flex items-center gap-2 text-body">
        <input
          id={toggleId}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        Habilitar edição (entendo que são parâmetros sensíveis)
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          max_tokens (todos os modelos)
        </span>
        <input
          name="maxTokens"
          type="number"
          defaultValue={current.maxTokens}
          min={MAX_TOKENS_MIN}
          max={MAX_TOKENS_MAX}
          step={1}
          disabled={!enabled}
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <span className="text-meta text-muted-foreground">
          Teto de saída. Nos modelos adaptive (Opus / Sonnet 4.6) o thinking
          conta aqui — valores baixos cortam a tool call.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          effort (só modelos adaptive)
        </span>
        <div className="max-w-aside">
          <Select name="effort" defaultValue={current.effort} disabled={!enabled}>
            {EFFORT_LEVELS.map((level) => (
              <option
                key={level}
                value={level}
                className="bg-popover text-popover-foreground"
              >
                {level}
              </option>
            ))}
          </Select>
        </div>
        <span className="text-meta text-muted-foreground">
          Profundidade do raciocínio. Ignorado pelos modelos temperature (Sonnet
          4.5 / Haiku).
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          temperature (só modelos temperature)
        </span>
        <input
          name="temperature"
          type="number"
          defaultValue={current.temperature}
          min={TEMPERATURE_MIN}
          max={TEMPERATURE_MAX}
          step={0.05}
          disabled={!enabled}
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <span className="text-meta text-muted-foreground">
          Aleatoriedade da amostragem. Só Sonnet 4.5 / Haiku; ignorado pelos
          adaptive.
        </span>
      </label>

      <Button type="submit" disabled={!enabled || pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar parâmetros"}
      </Button>

      {state &&
        (state.ok ? (
          <p className="text-body text-edge-fg" role="status" aria-live="polite">
            Parâmetros salvos.
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
