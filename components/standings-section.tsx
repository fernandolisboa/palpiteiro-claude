import { cn } from "@/lib/utils";
import type { StandingsView } from "@/lib/view/types";

type Props = {
  view: StandingsView;
};

export function StandingsSection({ view }: Props) {
  if (view.rows.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground tracking-tight">
        Classificação indisponível.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[20px_1fr_36px_36px_44px] gap-2 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
              "grid grid-cols-[20px_1fr_36px_36px_44px] items-center gap-2 rounded-md px-1 py-1.5 text-[12px] tracking-tight tabular-nums",
              r.focus && "bg-accent-soft text-accent-fg",
            )}
          >
            <span className="font-mono text-[11px] text-muted-foreground">{r.pos}</span>
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
