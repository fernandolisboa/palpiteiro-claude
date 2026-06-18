"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
  // Modelos selecionáveis para a audiência atual (resolvidos no server e
  // passados como {id,label} serializável). A garantia de gating é server-side
  // em analyzeMatch; aqui só limitamos o que aparece no <select>.
  models: { id: string; label: string }[];
  // Label do default global (resolvido no server) pra rotular a opção
  // "Usar padrão global (…)" e deixar explícito qual modelo ela usa.
  defaultModelLabel: string;
};

// Controle de override por análise. Vive dentro do <form> do AnalysisPanel,
// então `modelOverride` viaja no mesmo FormData da action analyzeMatch. Default
// "default" = usar o padrão global. Controlado pelo AnalysisPanel, que usa o
// valor pra rotular o passo "gerando análise (…)" com o modelo escolhido.
export function ModelOverrideSelect({
  value,
  onChange,
  models,
  defaultModelLabel,
}: Props) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground">
        modelo
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
        className="h-8 w-full max-w-xs rounded-md border border-border bg-transparent px-3 text-body-sm text-foreground outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:[color-scheme:dark]"
      >
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
      </select>
    </label>
  );
}
