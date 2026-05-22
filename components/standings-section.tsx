import { cn } from "@/lib/utils";

type Row = { pos: number; team: string; p: number; gf: number; ga: number; focus?: boolean };

const ROWS: Row[] = [
  { pos: 1, team: "Botafogo", p: 22, gf: 18, ga: 7 },
  { pos: 2, team: "Palmeiras", p: 21, gf: 16, ga: 8, focus: true },
  { pos: 3, team: "Bahia", p: 19, gf: 14, ga: 9 },
  { pos: 4, team: "Flamengo", p: 18, gf: 15, ga: 10, focus: true },
  { pos: 5, team: "Fortaleza", p: 17, gf: 12, ga: 8 },
];

export function StandingsSection() {
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[20px_1fr_36px_36px_44px] gap-2 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>#</span>
        <span>time</span>
        <span className="text-right">pts</span>
        <span className="text-right">gp</span>
        <span className="text-right">sg</span>
      </div>
      {ROWS.map((r) => {
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
