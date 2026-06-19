"use client";

import { ModelSelect } from "@/components/model-select";

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
      <ModelSelect
        name="modelOverride"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        models={models}
        defaultModelLabel={defaultModelLabel}
      />
    </label>
  );
}
