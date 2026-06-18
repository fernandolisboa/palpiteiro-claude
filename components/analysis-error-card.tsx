import { RefreshCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

export function AnalysisErrorCard({ error }: { error: string }) {
  return (
    <Callout
      variant="warn"
      icon={<TriangleAlert className="size-4" />}
      title="Falha na análise"
    >
      <span className="text-body-sm leading-relaxed text-muted-foreground tracking-tight">
        {error}
      </span>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" variant="default">
          <RefreshCcw className="size-3.5" /> Tentar novamente
        </Button>
      </div>
    </Callout>
  );
}
