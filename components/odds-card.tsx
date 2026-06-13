import { TriangleAlert } from "lucide-react";

import { HelpHint } from "@/components/help-hint";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OddsView } from "@/lib/view/types";

type Props = {
  view: OddsView | null;
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
      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-1 border-r border-border-subtle px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {view.overLabel}
          </span>
          <span className="font-mono text-[22px] font-medium tabular-nums tracking-tight">
            {view.over}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {view.overPct} normalizada
            <HelpHint
              anchor="prob-implicita"
              label="prob. do mercado (normalizada)"
              blurb="A chance que a odd embute, já descontada a margem da casa. Normaliza os dois lados; nunca é 1/odd cru."
            />
          </span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {view.underLabel}
          </span>
          <span className="font-mono text-[22px] font-medium tabular-nums tracking-tight">
            {view.under}
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {view.underPct} normalizada
          </span>
        </div>
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
