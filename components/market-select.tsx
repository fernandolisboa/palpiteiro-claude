"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
  // Mercados selecionáveis para a audiência atual (resolvidos no server e
  // passados como {key,label} serializável). A garantia de gating é server-side
  // em analyzeMatch; aqui só limitamos o que aparece no <select>.
  markets: { key: string; label: string }[];
};

// Seletor de mercado por análise. Vive dentro do <form> do AnalysisPanel, então
// `marketKey` viaja no mesmo FormData da action analyzeMatch. Espelha o
// ModelOverrideSelect: o AnalysisPanel só o renderiza quando há >1 mercado
// (mercado único → hidden, default over_under).
export function MarketSelect({ value, onChange, markets }: Props) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground">
        mercado
      </span>
      <select
        name="marketKey"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Mesma tematização do ModelOverrideSelect: `color-scheme` dá o chrome do
        // popup nativo, mas o Chromium não herda a cor do texto pras <option> —
        // por isso a cor vai direto em cada option (bg-popover/text-popover-foreground).
        className="h-8 w-full max-w-xs rounded-md border border-border bg-transparent px-3 text-body-sm text-foreground outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:[color-scheme:dark]"
      >
        {markets.map((m) => (
          <option
            key={m.key}
            value={m.key}
            className="bg-popover text-popover-foreground"
          >
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
