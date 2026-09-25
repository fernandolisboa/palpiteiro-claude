"use client";

import { useActionState } from "react";

import {
  updatePreferredModel,
  type UpdateProfileResult,
} from "@/app/actions/profile";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import { isAIModelId } from "@/lib/ai/models";

type Props = {
  // Modelos que esta audiência pode escolher ({id,label} serializável,
  // resolvido no server). A garantia de gating é server-side em
  // updatePreferredModel.
  models: { id: string; label: string }[];
  // Preferência atual crua do DB (pode ser null = sem preferência, ou um id
  // stale/fora-da-audiência). Só vira defaultValue se ainda estiver na lista.
  preferredModelId: string | null;
  // Label do default global (resolvido no server) pra rotular a opção
  // "Usar padrão global (…)" e deixar explícito qual modelo ela usa.
  defaultModelLabel: string;
};

export function PreferredModelForm({
  models,
  preferredModelId,
  defaultModelLabel,
}: Props) {
  const [state, action, pending] = useActionState<
    UpdateProfileResult | null,
    FormData
  >(updatePreferredModel, null);

  // Só pré-seleciona a preferência se ela for um id válido E presente na lista
  // desta audiência (preferência fora da audiência ou id stale/removido cai em
  // "padrão global").
  const initial =
    preferredModelId &&
    isAIModelId(preferredModelId) &&
    models.some((m) => m.id === preferredModelId)
      ? preferredModelId
      : "default";

  return (
    // key = valor persistido: o React 19 reseta o <form> depois de uma action e
    // volta os campos não controlados pro defaultValue da MONTAGEM (o do select não
    // acompanha o prop). Remontar quando o servidor devolve o valor novo faz o reset
    // cair no valor salvo em vez do antigo.
    <form key={initial} action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground font-mono text-eyebrow tracking-label uppercase">
          modelo preferido
        </span>
        <ModelSelect
          name="preferredModelId"
          defaultValue={initial}
          models={models}
          defaultModelLabel={defaultModelLabel}
        />
        <span className="text-muted-foreground text-meta">
          Escolha o modelo usado nas suas análises. Você ainda pode trocar o
          modelo numa análise específica.
        </span>
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar"}
      </Button>

      {state &&
        (state.ok ? (
          <p
            className="text-edge-fg text-body"
            role="status"
            aria-live="polite"
          >
            Preferência atualizada.
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
