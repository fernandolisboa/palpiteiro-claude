import { TriangleAlert } from "lucide-react";

import { HelpHint } from "@/components/help-hint";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OddsView } from "@/lib/view/types";

type Props = {
  view: OddsView | null;
};

// Classe de grid estática por nº de seleções — Tailwind não interpola classes
// dinâmicas (`grid-cols-${n}` seria purgado). over/under=2, 1X2=3.
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export function OddsCard({ view }: Props) {
  if (!view) {
    return (
      <Card className="gap-0 p-0">
        <div className="flex items-start gap-3 px-4 py-4">
          <span className="pt-0.5 text-muted-fg-2">
            <TriangleAlert className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium tracking-tight">
              Odds indisponíveis
            </span>
            <span className="text-[12px] text-muted-foreground tracking-tight">
              Sem cotação publicada para este jogo. Análise indisponível até que o
              mercado abra.
            </span>
            <span className="pt-1 font-mono text-[10.5px] text-muted-fg-2">
              fonte: the-odds-api
            </span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium tracking-tight">Odds atuais</span>
          <Badge
            variant="outline"
            className="h-[17px] rounded-full px-2 text-[9.5px] text-muted-foreground"
          >
            {view.marketLabel}
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          atualizado há {view.updatedAgo}
        </span>
      </div>
      <Separator />
      {/* Grid N-vias: 2 col (over/under) ou 3 (1X2). Classe estática por N
          (Tailwind não interpola). A cell 0 carrega o HelpHint da implícita e
          `flex items-center gap-1` no pct; demais cells o pct é plano. `border-r`
          em toda cell menos a última. n=2 = byte-idêntico ao binário (golden). */}
      <div className={`grid ${GRID_COLS[view.outcomes.length]}`}>
        {view.outcomes.map((o, i) => {
          const isFirst = i === 0;
          const isLast = i === view.outcomes.length - 1;
          return (
            <div
              key={i}
              className={`flex flex-col gap-1 ${isLast ? "" : "border-r border-border-subtle "}px-4 py-3.5`}
            >
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {o.label}
              </span>
              <span className="font-mono text-[22px] font-medium tabular-nums tracking-tight">
                {o.odd}
              </span>
              <span
                className={
                  isFirst
                    ? "flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-muted-foreground"
                    : "font-mono text-[10.5px] tabular-nums text-muted-foreground"
                }
              >
                {o.pct} normalizada
                {isFirst && (
                  <HelpHint
                    anchor="prob-implicita"
                    label="prob. do mercado (normalizada)"
                    blurb="A chance que a odd embute, já descontada a margem da casa. Normaliza os dois lados; nunca é 1/odd cru."
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <Separator />
      <div className="flex items-center justify-between px-4 py-2.5 font-mono text-[10px] text-muted-fg-2">
        <span>bookmaker · {view.bookmaker}</span>
        <span className="flex items-center gap-1 tabular-nums">
          overround {view.overround}
          <HelpHint
            anchor="overround"
            label="overround"
            blurb="A margem embutida pela casa. Por isso, no cru, over% + under% somam mais de 100% — o excedente é a margem."
          />
        </span>
      </div>
    </Card>
  );
}
