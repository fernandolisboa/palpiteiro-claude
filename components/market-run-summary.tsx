import { CircleAlert, Clock } from "lucide-react";

import type { MarketRunSummaryItem } from "@/app/actions/predictions";
import { Callout } from "@/components/ui/callout";

// Banner do disparo multi-mercado (#245): lista SÓ os mercados que NÃO viraram seção (failed /
// rate-limited), na ordem do dispatch. Os `ok` falam por si (aparecem como seções via
// revalidate). Todos ok → não renderiza nada. Falha de mercado single é roteada pro
// AnalysisErrorCard no NewAnalysisForm (paridade AC4) — este banner é só pro caso multi.
export function MarketRunSummary({ items }: { items: MarketRunSummaryItem[] }) {
  const problems = items.filter((i) => i.status !== "ok");
  if (problems.length === 0) return null;
  return (
    // Callout sem ícone (layout list-leading) com título warn-fg — o Callout
    // colore só o ícone por variante, então o cue de aviso vai no nó do título.
    <Callout
      variant="warn"
      title={
        <span className="text-warn-fg">Alguns mercados não foram analisados</span>
      }
    >
      <ul className="flex flex-col gap-1">
        {problems.map((p) => (
          <li
            key={p.marketKey}
            className="flex items-start gap-2 text-body-sm tracking-tight text-muted-foreground"
          >
            <span className="pt-0.5 text-muted-fg-2">
              {p.status === "rate-limited" ? (
                <Clock className="size-3.5" />
              ) : (
                <CircleAlert className="size-3.5" />
              )}
            </span>
            <span>
              <span className="text-foreground">{p.marketLabel}:</span>{" "}
              {p.message}
            </span>
          </li>
        ))}
      </ul>
    </Callout>
  );
}
