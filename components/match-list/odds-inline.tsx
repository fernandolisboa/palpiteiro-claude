import { cn } from "@/lib/utils";
import type { MatchRowView } from "@/lib/view/types";

type Outcome = NonNullable<MatchRowView["odds"]>["outcomes"][number];

// Odds da linha lado a lado (#577): uma célula por seleção (3 no 1X2, 2 no total de
// gols), rótulo em cima e odd embaixo, alinhadas à direita. Os rótulos já chegam
// curtos da view (sigla, "Empate", "Mais de 2,5"; lib/view/odds.ts). Server-safe:
// usado pela linha do celular (server) e pela grade do desktop (client).
export function OddsInline({
  outcomes,
  className,
}: {
  outcomes: readonly Outcome[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-3 text-right",
        outcomes.length === 3 ? "grid-cols-3" : "grid-cols-2",
        className,
      )}
    >
      {outcomes.map((o, i) => (
        <span key={i} className="flex min-w-10 flex-col items-end gap-0.5">
          <span className="whitespace-nowrap text-meta text-muted-foreground">{o.label}</span>
          <span className="font-mono text-body-sm tabular-nums">{o.odd}</span>
        </span>
      ))}
    </div>
  );
}
