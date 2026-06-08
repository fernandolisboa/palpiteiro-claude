"use client";

import { SELECTABLE_MODELS } from "@/lib/ai/models";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

// Controle admin-only de override por análise. Vive dentro do <form> do
// AnalysisPanel, então `modelOverride` viaja no mesmo FormData da action
// analyzeMatch. Default "default" = usar o padrão global (um admin que não
// mexe se comporta como usuário comum). Controlado pelo AnalysisPanel, que usa
// o valor pra rotular o passo "gerando análise (…)" com o modelo escolhido.
export function ModelOverrideSelect({ value, onChange }: Props) {
  return (
    <label className="flex flex-col gap-1 pb-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        modelo (admin)
      </span>
      <select
        name="modelOverride"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // `color-scheme` tematiza o fundo/chrome do popup nativo, MAS o Chromium
        // não herda o `color` do <select> pras <option> do popup — sem cor
        // explícita na própria option, o texto saía escuro no dark (escuro no
        // escuro). Por isso a cor vai DIRETO em cada <option> abaixo
        // (`bg-popover`/`text-popover-foreground`, que viram com o tema).
        className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-[12.5px] text-foreground [color-scheme:light] dark:[color-scheme:dark]"
      >
        <option value="default" className="bg-popover text-popover-foreground">
          Usar padrão global
        </option>
        {SELECTABLE_MODELS.map((m) => (
          <option
            key={m.id}
            value={m.id}
            className="bg-popover text-popover-foreground"
          >
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
