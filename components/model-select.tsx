import type { ComponentProps } from "react";

import { Select } from "@/components/ui/select";

type Props = {
  models: { id: string; label: string }[];
  defaultModelLabel: string;
} & ComponentProps<"select">;

/**
 * Select de modelo compartilhado (ADR 0029 / #325): a opção "Usar padrão global
 * (…)" + a lista de modelos, sobre o primitivo `Select` (foco/chevron/color-scheme).
 * Suporta os dois modos pelo spread: form-uncontrolled (`name`+`defaultValue`) ou
 * controlled (`value`+`onChange`). Constrange a largura no wrapper externo
 * (`max-w-aside`), NUNCA via `className` no Select — que cairia no `<select>`
 * interno e descolaria a chevron `absolute` do `<div relative>` do primitivo.
 *
 * Consumido pelo perfil (`preferred-model-form`). É o seam pronto pra a análise
 * (`model-override-select` + `market-select`) migrar junto numa fatia de match
 * futura (manter a linha do AnalysisPanel coerente).
 *
 * `bg-popover text-popover-foreground` em cada `<option>` é obrigatório: o
 * Chromium não herda a cor do `<select>` pro popup nativo (texto escuro no dark).
 */
export function ModelSelect({ models, defaultModelLabel, ...selectProps }: Props) {
  return (
    <div className="max-w-aside">
      <Select {...selectProps}>
        <option value="default" className="bg-popover text-popover-foreground">
          Usar padrão global ({defaultModelLabel})
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
      </Select>
    </div>
  );
}
