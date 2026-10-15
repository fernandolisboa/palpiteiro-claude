import { ResultBadge } from "@/components/result-badge";
import { Card } from "@/components/ui/card";

import { PREVIEW_AWAY, PREVIEW_HOME, PREVIEW_SLIP_LEGS } from "./preview-data";

/**
 * Ilustração de Suas apostas (ADR 0059): o jogo e as seleções anotadas, cada uma
 * "Em aberto". Sem odd, sem stake e sem vantagem (ADR 0048 D4). Segue o arranjo do
 * `SlipCard` (components/bets/slip-card.tsx), que não entra aqui porque pede a linha
 * do banco e escreve a data relativa ao "agora" (a landing é estática).
 */
export function ApostasPreview() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            Combinada · {PREVIEW_SLIP_LEGS.length} seleções
          </span>
          <span className="text-body font-medium tracking-tight text-foreground">
            {PREVIEW_HOME.name} × {PREVIEW_AWAY.name}
          </span>
        </div>
        <ResultBadge result="pending" size="sm" />
      </div>
      <ul className="flex flex-col gap-3 border-t border-border px-4 py-3">
        {PREVIEW_SLIP_LEGS.map((label) => (
          <li key={label} className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-body-sm tracking-tight text-foreground">{label}</span>
            <ResultBadge result="pending" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
