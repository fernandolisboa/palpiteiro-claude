"use client";

import { SELECTABLE_MODELS } from "@/lib/ai/models";

// Controle admin-only de override por análise. Vive dentro do <form> do
// AnalysisPanel, então `modelOverride` viaja no mesmo FormData da action
// analyzeMatch. Default "default" = usar o padrão global (um admin que não
// mexe se comporta como usuário comum).
export function ModelOverrideSelect() {
  return (
    <label className="flex flex-col gap-1 pb-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        modelo (admin)
      </span>
      <select
        name="modelOverride"
        defaultValue="default"
        className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-[12.5px]"
      >
        <option value="default">Usar padrão global</option>
        {SELECTABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
