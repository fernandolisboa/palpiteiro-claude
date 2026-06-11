"use client";

import { useActionState, useId, useState } from "react";

import {
  updateGenerationParams,
  type UpdateGenerationParamsResult,
} from "@/app/actions/ai-config";
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
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-700 dark:text-amber-300"
      >
        <p className="font-medium">⚠ Parâmetros sensíveis</p>
        <p className="mt-1 text-amber-700/90 dark:text-amber-300/90">
          Estes valores afetam custo, qualidade e latência de{" "}
          <strong>toda análise</strong>, para todos os usuários. Os campos
          começam bloqueados — habilite a edição abaixo só se souber o que está
          fazendo.
        </p>
      </div>

      <label htmlFor={toggleId} className="flex items-center gap-2 text-[13px]">
        <input
          id={toggleId}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4"
        />
        Habilitar edição (entendo que são parâmetros sensíveis)
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-50"
        />
        <span className="text-[11px] text-muted-foreground">
          Teto de saída. Nos modelos adaptive (Opus / Sonnet 4.6 / Fable) o
          thinking conta aqui — valores baixos cortam a tool call.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          effort (só modelos adaptive)
        </span>
        <select
          name="effort"
          defaultValue={current.effort}
          disabled={!enabled}
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground [color-scheme:light] disabled:opacity-50 dark:[color-scheme:dark]"
        >
          {EFFORT_LEVELS.map((level) => (
            <option
              key={level}
              value={level}
              className="bg-popover text-popover-foreground"
            >
              {level}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">
          Profundidade do raciocínio. Ignorado pelos modelos temperature (Sonnet
          4.5 / Haiku).
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-50"
        />
        <span className="text-[11px] text-muted-foreground">
          Aleatoriedade da amostragem. Só Sonnet 4.5 / Haiku; ignorado pelos
          adaptive.
        </span>
      </label>

      <button
        type="submit"
        disabled={!enabled || pending}
        className="w-fit rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar parâmetros"}
      </button>

      {state &&
        (state.ok ? (
          <p className="text-[13px] text-accent-fg">Parâmetros salvos.</p>
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
