import { Trophy } from "lucide-react";

import { ResultBadge } from "@/components/result-badge";
import { Card } from "@/components/ui/card";
import { POOL_KIND_LABEL } from "@/lib/view/friend-pool";

import {
  PREVIEW_AWAY,
  PREVIEW_FINAL_SCORE,
  PREVIEW_HOME,
  PREVIEW_POOL_ENTRIES,
} from "./preview-data";

/**
 * Ilustração do bolão (ADR 0059): o placar final, os palpites dos amigos com o selo
 * de cada um e quem ganhou. Os selos são dos amigos fictícios, não do app. Sem R$ e
 * sem pote (o valor é opcional no bolão, ADR 0054). Segue o arranjo de
 * `app/(app)/bolao/[id]/page.tsx`.
 */
export function BolaoPreview() {
  const winners = PREVIEW_POOL_ENTRIES.filter((e) => e.won).map((e) => e.name);
  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-2 px-5 py-4">
        <p className="text-meta uppercase tracking-label text-muted-foreground">
          resultado · placar do jogo
        </p>
        <p className="text-body font-medium tabular-nums tracking-tight">
          {PREVIEW_HOME.name} {PREVIEW_FINAL_SCORE.home} × {PREVIEW_FINAL_SCORE.away}{" "}
          {PREVIEW_AWAY.name}
        </p>
        <p className="flex items-center gap-2 text-display-sm font-medium tracking-tight">
          <Trophy className="size-5 shrink-0" aria-hidden />
          Ganhou: {winners.join(", ")}
        </p>
      </Card>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {PREVIEW_POOL_ENTRIES.map((e) => (
          <li key={e.name} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-12 flex-1 truncate text-body font-medium tracking-tight">
              {e.name}
            </span>
            <span className="min-w-0 truncate text-right text-body-sm tabular-nums tracking-tight">
              <span className="text-meta text-muted-foreground">
                {POOL_KIND_LABEL.exact_score} ·{" "}
              </span>
              {PREVIEW_HOME.short} {e.home} × {e.away} {PREVIEW_AWAY.short}
            </span>
            <ResultBadge result={e.won ? "won" : "lost"} />
          </li>
        ))}
      </ul>
    </div>
  );
}
