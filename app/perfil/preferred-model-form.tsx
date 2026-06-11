"use client";

import { useActionState } from "react";

import {
  updatePreferredModel,
  type UpdateProfileResult,
} from "@/app/actions/profile";
import { isAIModelId } from "@/lib/ai/models";

type Props = {
  // Modelos que esta audiência pode escolher ({id,label} serializável,
  // resolvido no server). A garantia de gating é server-side em
  // updatePreferredModel.
  models: { id: string; label: string }[];
  // Preferência atual crua do DB (pode ser null = sem preferência, ou um id
  // stale/fora-da-audiência). Só vira defaultValue se ainda estiver na lista.
  preferredModelId: string | null;
};

export function PreferredModelForm({ models, preferredModelId }: Props) {
  const [state, action, pending] = useActionState<
    UpdateProfileResult | null,
    FormData
  >(updatePreferredModel, null);

  // Só pré-seleciona a preferência se ela for um id válido E presente na lista
  // desta audiência (ex-admin rebaixado com Fable salvo cai em "padrão global").
  const initial =
    preferredModelId &&
    isAIModelId(preferredModelId) &&
    models.some((m) => m.id === preferredModelId)
      ? preferredModelId
      : "default";

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          modelo preferido
        </span>
        <select
          name="preferredModelId"
          defaultValue={initial}
          className="border-border text-foreground w-80 max-w-xs rounded-md border bg-transparent px-3 py-2 text-[12.5px] [color-scheme:light] dark:[color-scheme:dark]"
        >
          <option value="default" className="bg-popover text-popover-foreground">
            Usar padrão global
          </option>
          {models.map((m) => (
            <option
              key={m.id}
              value={m.id}
              className="bg-popover text-popover-foreground"
            >
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-[11px]">
          Escolha o modelo usado nas suas análises. Você ainda pode trocar o
          modelo numa análise específica.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="border-border bg-foreground text-background w-fit rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar"}
      </button>

      {state &&
        (state.ok ? (
          <p className="text-accent-fg text-[13px]">Preferência atualizada.</p>
        ) : (
          <p className="text-[13px] text-red-500">{state.error}</p>
        ))}
    </form>
  );
}
