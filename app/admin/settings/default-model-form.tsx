"use client";

import { useActionState } from "react";

import {
  updateDefaultModel,
  type UpdateDefaultModelResult,
} from "@/app/actions/ai-config";
import { SELECTABLE_MODELS, type AIModelId } from "@/lib/ai/models";

// O default global vale pra TODOS, então só um modelo `userSelectable` pode ser
// salvo — o server revalida via isModelAllowedForAudience(false) em
// updateDefaultModel (ADR 0013). Hoje, após #240 (ambos Sonnets selecionáveis) +
// #241 (Fable removido), TODO o registry é userSelectable, então a lista inteira
// é salvável. Mas em vez de FILTRAR modelos admin-only (sumiço silencioso), o
// dropdown lista todos e desabilita os não-salváveis com nota — defensivo pra um
// futuro modelo admin-only não reaparecer como "disponível mas impossível de
// salvar". A ordem do registry rege a UI.
const DEFAULT_MODEL_OPTIONS = SELECTABLE_MODELS;

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
          className="text-foreground w-80 rounded-md border border-border bg-transparent px-3 py-2 text-sm [color-scheme:light] dark:[color-scheme:dark]"
        >
          {DEFAULT_MODEL_OPTIONS.map((m) => (
            <option
              key={m.id}
              value={m.id}
              // Admin-only (userSelectable:false) NÃO pode virar padrão global —
              // renderiza desabilitado com nota em vez de sumir (feedback visual).
              disabled={!m.userSelectable}
              className="bg-popover text-popover-foreground"
            >
              {m.label} — ${m.inputPricePerMTok}/${m.outputPricePerMTok} por 1M
              {m.userSelectable
                ? ""
                : " (admin-only — indisponível como padrão)"}
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
