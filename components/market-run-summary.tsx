import { CircleAlert, Clock } from "lucide-react";

import type { MarketRunSummaryItem } from "@/app/actions/predictions";
import { Card } from "@/components/ui/card";

// Banner do disparo multi-mercado (#245): lista SÓ os mercados que NÃO viraram seção (failed /
// rate-limited), na ordem do dispatch. Os `ok` falam por si (aparecem como seções via
// revalidate). Todos ok → não renderiza nada. Falha de mercado single é roteada pro
// AnalysisErrorCard no NewAnalysisForm (paridade AC4) — este banner é só pro caso multi.
export function MarketRunSummary({ items }: { items: MarketRunSummaryItem[] }) {
  const problems = items.filter((i) => i.status !== "ok");
  if (problems.length === 0) return null;
  return (
    <Card className="border-warn-border bg-card">
      <div className="flex flex-col gap-2 px-4 py-3">
        <span className="text-[12px] font-medium tracking-tight text-warn-fg">
          Alguns mercados não foram analisados
        </span>
        <ul className="flex flex-col gap-1">
          {problems.map((p) => (
            <li
              key={p.marketKey}
              className="flex items-start gap-2 text-[12px] tracking-tight text-muted-foreground"
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
      </div>
    </Card>
  );
}
