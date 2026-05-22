import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Row = {
  date: string;
  h: string;
  a: string;
  s: string;
  tag: "over" | "under";
};

const ROWS: Row[] = [
  { date: "15 fev 25", h: "Palmeiras", a: "Flamengo", s: "2 – 2", tag: "over" },
  { date: "04 out 24", h: "Flamengo", a: "Palmeiras", s: "1 – 3", tag: "over" },
  { date: "18 jul 24", h: "Palmeiras", a: "Flamengo", s: "0 – 1", tag: "under" },
  { date: "21 abr 24", h: "Flamengo", a: "Palmeiras", s: "2 – 1", tag: "over" },
  { date: "12 nov 23", h: "Palmeiras", a: "Flamengo", s: "1 – 0", tag: "under" },
];

export function H2HSection() {
  return (
    <div className="flex flex-col">
      {ROWS.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-between py-2",
            i !== ROWS.length - 1 && "border-b border-border-subtle",
          )}
        >
          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {r.date}
          </span>
          <div className="flex-1 px-3 text-[12px] tracking-tight">
            <span className="text-foreground">{r.h}</span>{" "}
            <span className="font-mono tabular-nums text-foreground">{r.s}</span>{" "}
            <span className="text-foreground">{r.a}</span>
          </div>
          <Badge
            variant="outline"
            className={
              r.tag === "over"
                ? "h-[18px] rounded-full border-edge-border bg-edge-soft px-2 text-[9.5px] text-edge-fg"
                : "h-[18px] rounded-full border-border bg-transparent px-2 text-[9.5px] text-muted-foreground"
            }
          >
            {r.tag === "over" ? "3+ gols" : "< 3"}
          </Badge>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3 font-mono text-[10.5px] text-muted-foreground">
        <span>últimos 5 confrontos</span>
        <span className="tabular-nums">over 60% · média 2.4 gols</span>
      </div>
    </div>
  );
}
