import { TriangleAlert, ArrowUp, ArrowDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Props = {
  noOdds?: boolean;
  over?: string;
  under?: string;
  overPct?: string;
  underPct?: string;
  bookmaker?: string;
  overround?: string;
  updatedAgo?: string;
};

export function OddsCard({
  noOdds = false,
  over = "1.92",
  under = "1.88",
  overPct = "50.7%",
  underPct = "49.3%",
  bookmaker = "bet365",
  overround = "2.6%",
  updatedAgo = "2min",
}: Props) {
  if (noOdds) {
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
              Sem cotação de over/under 2.5 publicada para este jogo. Análise indisponível
              até que o mercado abra.
            </span>
            <span className="pt-1 font-mono text-[10.5px] text-muted-fg-2">
              fonte: the-odds-api · checado há 2min
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
            over/under 2.5
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          atualizado há {updatedAgo}
        </span>
      </div>
      <Separator />
      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-1 border-r border-border-subtle px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <ArrowUp className="size-3.5" /> Over 2.5
          </span>
          <span className="font-mono text-[22px] font-medium tabular-nums tracking-tight">
            {over}
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {overPct} normalizada
          </span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <ArrowDown className="size-3.5" /> Under 2.5
          </span>
          <span className="font-mono text-[22px] font-medium tabular-nums tracking-tight">
            {under}
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {underPct} normalizada
          </span>
        </div>
      </div>
      <Separator />
      <div className="flex items-center justify-between px-4 py-2.5 font-mono text-[10px] text-muted-fg-2">
        <span>bookmaker · {bookmaker}</span>
        <span className="tabular-nums">overround {overround}</span>
      </div>
    </Card>
  );
}
