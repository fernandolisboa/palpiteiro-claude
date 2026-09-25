"use client";

import { useActionState } from "react";

import {
  updateDefaultModel,
  type UpdateDefaultModelResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SELECTABLE_MODELS, type AIModelId } from "@/lib/ai/models";

// O default global vale pra TODOS, então só um modelo `userSelectable` pode ser
// salvo — o server revalida via isModelAllowedForAudience(false) em
// updateDefaultModel (ADR 0013). O Fable 5.1 (#524) é admin-only: em vez de
// FILTRÁ-LO (sumiço silencioso), o dropdown lista todos e desabilita os
// não-salváveis com nota — assim ele não aparece como "disponível mas impossível
// de salvar". A ordem do registry rege a UI.
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
    // key = valor persistido: o React 19 reseta o <form> depois de uma action e
    // volta os campos não controlados pro defaultValue da MONTAGEM (o do select não
    // acompanha o prop). Remontar quando o servidor devolve o valor novo faz o reset
    // cair no valor salvo em vez do antigo.
    <form key={current} action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          modelo padrão global
        </span>
        <div className="max-w-aside">
          <Select name="modelId" defaultValue={current}>
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
          </Select>
        </div>
      </label>

      <p className="text-body-sm text-muted-foreground">
        Define o modelo usado por padrão em toda análise. Vale para todos os
        usuários, sem redeploy. Admins podem sobrescrever por análise na página
        do jogo.
      </p>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar padrão"}
      </Button>

      {state &&
        (state.ok ? (
          <p className="text-body text-edge-fg" role="status" aria-live="polite">
            Padrão salvo.
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
