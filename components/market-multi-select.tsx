"use client";

import { cn } from "@/lib/utils";

type Props = {
  // Mercados selecionáveis para a audiência atual (server-validados; {key,label}). A garantia
  // de gate é server-side em analyzeMarkets — aqui só controlamos o que o usuário MARCA. A
  // submissão viaja por hidden inputs name="marketKeys" no <form> (não por estes checkboxes),
  // pra getAll("marketKeys") montar o array. Single-select degenera p/ hidden no NewAnalysisForm.
  markets: { key: string; label: string }[];
  value: Set<string>;
  onToggle: (key: string) => void;
};

// Multi-select de mercados (#245): grupo de chips/checkboxes controlado. Substitui o
// MarketSelect (dropdown single) no dispatcher de NOVA análise quando há >1 mercado sem seção.
// Funcional/enxuto — o polish visual é #246.
export function MarketMultiSelect({ markets, value, onToggle }: Props) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground">
        mercados
      </legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {markets.map((m) => {
          const checked = value.has(m.key);
          return (
            <label
              key={m.key}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-body-sm tracking-tight",
                checked
                  ? "border-accent-fg font-medium text-accent-fg"
                  : "border-border text-foreground",
              )}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-current rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                checked={checked}
                onChange={() => onToggle(m.key)}
              />
              {m.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
