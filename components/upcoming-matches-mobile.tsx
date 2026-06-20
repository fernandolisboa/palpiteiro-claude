"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MatchRow } from "@/components/match-row";
import type { MatchRowView } from "@/lib/view/types";

// Lote inicial e incremento do reveal client-side. Exportado pra que o teste
// asserte exatamente quantas linhas aparecem no primeiro render (não pode ser
// re-exportado de app/page.tsx — Next rejeita exports não-padrão num page file).
export const INITIAL_BATCH = 15;
const BATCH_STEP = 15;

export function UpcomingMatchesMobile({
  matches,
  listHref,
}: {
  matches: MatchRowView[];
  // URL filtrada da lista (/jogos?…) propagada ao link de cada jogo (ver MatchRow).
  listHref?: string;
}) {
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const slice = matches.slice(0, visible);
  return (
    <>
      <Card className="mx-5 gap-0 overflow-hidden p-0">
        {slice.map((m, i, arr) => (
          <MatchRow key={m.id} m={m} last={i === arr.length - 1} listHref={listHref} />
        ))}
      </Card>
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
    </>
  );
}
