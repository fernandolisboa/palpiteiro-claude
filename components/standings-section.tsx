import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { StandingsView } from "@/lib/view/types";

type Props = {
  view: StandingsView;
};

// Geometria de colunas da tabela (header + linhas). ADR 0029 não tem token de
// largura de track → const nomeada (fonte única, sem grid-cols-[…] mágico repetido).
const STANDINGS_GRID = "grid-cols-[20px_1fr_36px_36px_44px]";

export function StandingsSection({ view }: Props) {
  if (view.rows.length === 0) {
    return <EmptyState className="py-6" title="Classificação indisponível." />;
  }
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "grid gap-2 pb-2 font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground",
          STANDINGS_GRID,
        )}
      >
        <span>#</span>
        <span>time</span>
        <span className="text-right">pts</span>
        <span className="text-right">gp</span>
        <span className="text-right">sg</span>
      </div>
      {view.rows.map((r) => {
        const sg = r.gf - r.ga;
        return (
          <div
            key={r.team}
            className={cn(
              "grid items-center gap-2 rounded-md px-1 py-1.5 text-body-sm tracking-tight tabular-nums",
              STANDINGS_GRID,
              r.focus && "bg-accent-soft text-accent-fg",
            )}
          >
            <span className="font-mono text-meta text-muted-foreground">{r.pos}</span>
            <span className="font-medium">{r.team}</span>
            <span className="text-right font-mono">{r.p}</span>
            <span className="text-right font-mono">{r.gf}</span>
            <span className="text-right font-mono">
              {sg > 0 ? "+" : ""}
              {sg}
            </span>
          </div>
        );
      })}
    </div>
  );
}
