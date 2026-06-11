"use client";

import { useActionState } from "react";

import {
  updateDefaultModel,
  type UpdateDefaultModelResult,
} from "@/app/actions/ai-config";
import { modelsForAudience, type AIModelId } from "@/lib/ai/models";

// Default global vale pra TODOS, então o dropdown lista só modelos userSelectable
// (audiência usuário comum). Server revalida em updateDefaultModel (ADR 0013).
const DEFAULT_MODEL_OPTIONS = modelsForAudience(false);

type Props = {
  current: AIModelId;
};

export function DefaultModelForm({ current }: Props) {
  const [state, action, pending] = useActionState<
    UpdateDefaultModelResult | null,
    FormData
  >(updateDefaultModel, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          modelo padrão global
        </span>
        <select
          name="modelId"
          defaultValue={current}
          className="w-80 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
        >
          {DEFAULT_MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — ${m.inputPricePerMTok}/${m.outputPricePerMTok} por 1M
            </option>
          ))}
        </select>
      </label>

      <p className="text-[12px] text-muted-foreground">
        Define o modelo usado por padrão em toda análise. Vale para todos os
        usuários, sem redeploy. Admins podem sobrescrever por análise na página
        do jogo.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar padrão"}
      </button>

      {state &&
        (state.ok ? (
          <p className="text-[13px] text-accent-fg">Padrão salvo.</p>
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
