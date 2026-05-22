import { RefreshCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AnalysisErrorCard({ error }: { error: string }) {
  return (
    <Card className="border-warn-border bg-card">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="pt-0.5 text-warn-fg">
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium tracking-tight">
            Falha na análise
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground tracking-tight">
            {error}
          </span>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" variant="default">
              <RefreshCcw className="size-3.5" /> Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
