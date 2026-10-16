"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DayHeading } from "@/components/match-list/day-heading";
import { MatchRow } from "@/components/match-row";
import { tourMatchIndex } from "@/lib/tour/steps";
import { groupByDay } from "@/lib/view/match-list";
import type { MatchListRowView } from "@/lib/view/types";

// Lote inicial e incremento do reveal client-side. Exportado pra que o teste
// asserte exatamente quantas linhas aparecem no primeiro render (não pode ser
// re-exportado de app/page.tsx — Next rejeita exports não-padrão num page file).
export const INITIAL_BATCH = 15;
const BATCH_STEP = 15;

export function UpcomingMatchesMobile({
  matches,
  listHref,
  endNote,
}: {
  matches: MatchListRowView[];
  // URL filtrada da lista (/jogos?…) propagada ao link de cada jogo (ver MatchRow).
  listHref?: string;
  // Aviso no fim da lista cortada no teto da query, quando tudo já foi revelado.
  endNote?: string;
}) {
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const slice = matches.slice(0, visible);
  // Alvo do tour e reveal na lista PLANA; só depois agrupa por dia (#577). O grupo
  // do fim do lote cresce quando "Carregar mais" traz o resto do dia.
  const tourId = slice[tourMatchIndex(slice)]?.id;
  return (
    <>
      {groupByDay(slice).map((group, gi) => (
        <section key={`${group.key}-${gi}`}>
          <DayHeading label={group.label} variant="bleed" className={gi === 0 ? "pt-1" : undefined} />
          <Card className="mx-5 gap-0 overflow-hidden p-0">
            {group.rows.map((m, i, arr) => (
              <MatchRow
                key={m.id}
                m={m}
                last={i === arr.length - 1}
                listHref={listHref}
                tourTarget={m.id === tourId}
                timeLabel={m.startsIn ?? m.time}
              />
            ))}
          </Card>
        </section>
      ))}
      {visible < matches.length && (
        <div className="flex justify-center px-5 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisible((v) => v + BATCH_STEP)}
          >
            Carregar mais
          </Button>
        </div>
      )}
      {visible >= matches.length && endNote && (
        <p className="px-5 pt-3 text-center text-body-sm text-muted-foreground">{endNote}</p>
      )}
    </>
  );
}
