import type { ComponentProps } from "react";

import { Select } from "@/components/ui/select";

type Props = {
  models: { id: string; label: string }[];
  defaultModelLabel: string;
} & ComponentProps<"select">;

/**
 * Select de modelo compartilhado (ADR 0029 / #325): a opção "Usar padrão global
 * (…)" + a lista de modelos, sobre o primitivo `Select` (foco/chevron).
 * Suporta os dois modos pelo spread: form-uncontrolled (`name`+`defaultValue`) ou
 * controlled (`value`+`onChange`). Constrange a largura no wrapper externo
 * (`max-w-aside`), NUNCA via `className` no Select — que cairia no `<select>`
 * interno e descolaria a chevron `absolute` do `<div relative>` do primitivo.
 *
 * Consumido pelo perfil (`preferred-model-form`) e pelo `model-override-select`
 * da página do jogo.
 *
 * As cores da lista aberta vêm da regra global de `<select>`/`<option>` em
 * app/globals.css — nada de classe de cor nas `<option>`.
 */
export function ModelSelect({ models, defaultModelLabel, ...selectProps }: Props) {
  return (
    <div className="max-w-aside">
      <Select {...selectProps}>
        <option value="default">Usar padrão global ({defaultModelLabel})</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
