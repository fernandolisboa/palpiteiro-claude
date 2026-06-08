import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { H2HView } from "@/lib/view/types";

type Props = {
  view: H2HView;
};

export function H2HSection({ view }: Props) {
  if (view.rows.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground tracking-tight">
        Sem confrontos diretos recentes disponíveis.
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {view.rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-between py-2",
            i !== view.rows.length - 1 && "border-b border-border-subtle",
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
                ? "h-[18px] rounded-full border-border bg-secondary px-2 text-[9.5px] text-secondary-foreground"
                : "h-[18px] rounded-full border-border bg-transparent px-2 text-[9.5px] text-muted-foreground"
            }
          >
            {r.tag === "over" ? "3+ gols" : "< 3"}
          </Badge>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3 font-mono text-[10.5px] text-muted-foreground">
        <span>últimos {view.rows.length} confrontos</span>
        <span className="tabular-nums">{view.summary}</span>
      </div>
    </div>
  );
}
