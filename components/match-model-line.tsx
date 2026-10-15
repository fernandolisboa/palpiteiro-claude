import { cn } from "@/lib/utils";
import type { MatchModelLineView } from "@/lib/view/types";

// Linha da base do modelo no /jogos (#555, ADR 0052): "Modelo: PAL 42% · Menos de 2,5
// 59%". 12px (#577: a linha mais útil da lista, no cinza mais forte), rótulo sans e
// mono só nos números (ADR 0056). Sem "use client" e sem dependência de servidor:
// usada pela MatchRow (server) e pela UpcomingMatchesDesktop (client). Só
// probabilidade: nada de odd, edge ou valor (a base não expõe valor).
export function MatchModelLine({
  model,
  className,
}: {
  model: MatchModelLineView;
  className?: string;
}) {
  return (
    <span className={cn("text-body-sm text-muted-foreground", className)}>
      Modelo: {model.favorite.label}{" "}
      <span className="font-mono tabular-nums">{model.favorite.pct}</span> ·{" "}
      {model.goals25.label}{" "}
      <span className="font-mono tabular-nums">{model.goals25.pct}</span>
    </span>
  );
}
