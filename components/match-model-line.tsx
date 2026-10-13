import type { MatchModelLineView } from "@/lib/view/types";

// Linha compacta da base do modelo no /jogos (#555, ADR 0052): "Modelo · Casa 52% ·
// Under 2.5 55%". Sem "use client" e sem dependência de servidor: usada pela MatchRow
// (server) e pela UpcomingMatchesDesktop (client). Só probabilidade — nada de odd,
// edge ou valor (a base não expõe valor).
export function MatchModelLine({
  model,
  className,
}: {
  model: MatchModelLineView;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-eyebrow tabular-nums text-muted-fg-2${className ? ` ${className}` : ""}`}
    >
      Modelo · {model.favorite.label} {model.favorite.pct} · {model.goals25.label}{" "}
      {model.goals25.pct}
    </span>
  );
}
